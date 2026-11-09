from datetime import datetime, timezone
from datetime import date
import csv
from io import StringIO
from pathlib import Path, PureWindowsPath
import json
import math
import hashlib
from functools import lru_cache
from decimal import Decimal
from threading import BoundedSemaphore, Timer
from uuid import uuid4
from typing import Literal
from contextlib import ExitStack

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, TypeAdapter, model_validator
from sqlalchemy import select, update, delete, or_

from ..db import SessionLocal
from ..imports.delimited import parse_delimited, _value, infer_formats
from ..imports.excel import read_workbook
from ..models import Dataset, DatasetSnapshot, Dashboard, PublishedDashboard, DynamicSource
from ..settings import settings
from ..expressions import compile_expression
from ..storage import dataset_dir, write_dataset, rollback_files

router = APIRouter(prefix="/api")
# ponytail: concurrency is bounded per process; use a shared worker queue for multi-process deployments.
query_slots = BoundedSemaphore(settings.max_concurrent_queries)


class DisplayUpdate(BaseModel):
    kind: Literal['integer', 'decimal', 'text'] | None = None
    format: Literal['number', 'percent']
    decimals: int = Field(ge=0, le=4, strict=True)
    rounding: Literal['halfExpand', 'trunc'] = 'halfExpand'
    dateFormat: Literal['yyyy-MM-dd', 'MMM d', 'MMM d, yyyy', 'yyMMdd', 'yyyyMMdd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd', 'yyyy-MM'] | None = None
    valueLabels: dict[str, str] | None = None

    @model_validator(mode='after')
    def display_precision(self):
        if self.kind == 'integer':
            self.decimals = 0
        elif self.kind == 'decimal' and self.decimals == 0:
            raise ValueError('Decimal display requires 1–4 decimal places')
        return self


class PasteImport(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1)
    preview: bool = False
    has_header: bool = True
    overrides: dict[str, str] = Field(default_factory=dict)
    renames: dict[str, str] = Field(default_factory=dict)
    delimiter: str | None = None
    formats: dict[str, DisplayUpdate] = Field(default_factory=dict)
    field_order: list[str] = Field(default_factory=list)
    dataset_id: str | None = None
    version: int | None = Field(default=None, ge=1)
    confirm_conversion: bool = False
    annotation_fields: dict[str, str] = Field(default_factory=dict)
    annotation_order: list[str] = Field(default_factory=list)


def convert_preview(preview, overrides, renames=None, field_order=None, confirm_conversion=False, formats=None, annotation_fields=None):
    from ..imports.delimited import Field as Column, TabularPreview
    if field_order:
        if len(field_order) != len(set(field_order)) or not set(field_order).issubset(preview.headers):
            raise ValueError('Field order must contain valid unique fields')
        indices = [preview.headers.index(name) for name in field_order]
        if not annotation_fields:
            indices.sort(key=lambda index: overrides.get(preview.fields[index].name, preview.fields[index].type) in {'number', 'integer'})
        preview = TabularPreview([preview.headers[i] for i in indices], [[row[i] for i in indices] for row in preview.rows], [preview.fields[i] for i in indices], [[row[i] for i in indices] for row in preview.raw_rows] if preview.raw_rows is not None else None)
    renames = renames or {}
    names = [renames.get(field.name, field.name).strip() for field in preview.fields]
    if annotation_fields:
        annotation_rows(names, [], annotation_fields)
    if any(not name for name in names) or len(set(names)) != len(names):
        raise ValueError('Column names must be non-empty and unique')
    fields = [Column(names[index], overrides.get(field.name, field.type)) for index, field in enumerate(preview.fields)]
    if any(field.type not in {'string', 'number', 'integer', 'date'} for field in fields):
        raise ValueError('Unsupported column type')
    def convert(value, kind, field_name):
        if value is None:
            return None
        if kind == 'string':
            return str(value)
        if value == '':
            return None
        if kind in {'number', 'integer'}:
            if isinstance(value, Decimal):
                if not value.is_finite() or (kind == 'integer' and value != value.to_integral_value()):
                    raise ValueError(f'Invalid {kind}: {value}')
                return int(value) if kind == 'integer' else value
            if isinstance(value, str):
                parsed = _value(value)
                if parsed is None:
                    return None
                if type(parsed) in (int, float):
                    value = parsed
            if type(value) is int:
                return value
            if isinstance(value, str) and value.lstrip('+-').isdigit() and abs(int(value)) > 9007199254740991:
                raise ValueError('Integer exceeds exact browser precision; keep this column as string')
            try:
                number = float(value)
            except (TypeError, OverflowError) as error:
                raise ValueError(f'Invalid number: {value}') from error
            if not math.isfinite(number):
                raise ValueError(f'Invalid number: {value}')
            if kind == 'integer' and not number.is_integer():
                raise ValueError(f'Invalid integer: {value}; choose decimal to keep fractions')
            return int(number) if kind == 'integer' else number
        if kind == 'date':
            if annotation_fields and field_name in {annotation_fields['start'], annotation_fields['end']} and isinstance(value, str) and value.strip().upper() in {'NULL', '[NULL]', '\\N'}:
                return None
            try:
                if annotation_fields and field_name in {annotation_fields['start'], annotation_fields['end']}:
                    return annotation_date(value)
                return date.fromisoformat(str(value)[:10])
            except ValueError as error:
                raise ValueError(f'字段“{field_name}”的值“{value}”无法转换为日期。请使用 YYYY-MM-DD 格式（例如 2026-10-28），或将该字段改为文本或数值类型。') from error
        raise ValueError('Unsupported column type')
    issues = {}
    rows = []
    for row_index, row in enumerate(preview.rows):
        converted = []
        for index, value in enumerate(row):
            field = fields[index]
            raw = preview.raw_rows[row_index][index] if field.type == 'string' and preview.raw_rows and value is not None else value
            try:
                display = (formats or {}).get(field.name)
                display_kind = display.kind if isinstance(display, DisplayUpdate) else (display or {}).get('kind')
                result = convert(raw, 'number' if field.type == 'integer' and display_kind == 'decimal' else field.type, field.name)
                if display_kind == 'integer':
                    convert(result, 'integer', field.name)
            except (ValueError, TypeError, OverflowError):
                issue = issues.setdefault(field.name, {'field': field.name, 'type': field.type, 'examples': []})
                sample = str(value)[:160]
                if sample not in issue['examples'] and len(issue['examples']) < 3:
                    issue['examples'].append(sample)
                result = value if confirm_conversion else None
            converted.append(result)
        rows.append(converted)
    if issues and not confirm_conversion:
        raise HTTPException(422, detail={'code': 'type_conversion_required', 'fields': list(issues.values())})
    return TabularPreview(names, rows, fields, preview.raw_rows)


def preview_payload(preview):
    return {'schema': [{'name': f.name, 'type': f.type} for f in preview.fields], 'rows': [dict(zip(preview.headers, row)) for row in preview.rows[:5]], 'row_count': len(preview.rows), 'field_formats': infer_formats(preview)}


def annotation_date(value):
    if isinstance(value, date):
        return date.fromisoformat(value.isoformat()[:10])
    text = str(value).strip()
    if text.isdigit() and len(text) in {6, 8}:
        return datetime.strptime(('20' + text) if len(text) == 6 else text, '%Y%m%d').date()
    return datetime.strptime(text, '%Y/%m/%d').date() if '/' in text else date.fromisoformat(text)


def annotation_rows(headers, rows, fields):
    if set(fields) != {'start', 'end', 'label'} or len(headers) != 3 or set(fields.values()) != set(headers):
        raise HTTPException(422, 'Annotation 必须包含开始日期、结束日期、标签三列')
    indices = {role: headers.index(name) for role, name in fields.items()}
    result = []
    for row in rows:
        item = {}
        for role in ('start', 'end'):
            value = row[indices[role]]
            if value is None or isinstance(value, str) and value.strip().upper() in {'', 'NULL', '[NULL]', '\\N'}:
                item[role] = None
            else:
                try:
                    item[role] = annotation_date(value).isoformat()
                except (ValueError, TypeError):
                    raise HTTPException(422, 'Annotation 日期必须为 YYYY-MM-DD、YYYY/M/D 或 NULL') from None
        label = row[indices['label']]
        if label is None or not str(label).strip():
            raise HTTPException(422, 'Annotation 标签不能为空')
        if item['start'] and item['end'] and item['start'] > item['end']:
            raise HTTPException(422, 'Annotation 开始日期不能晚于结束日期')
        result.append({**item, 'label': str(label)})
    return result


def annotation_preview(preview, order):
    from ..imports.delimited import Field as Column, TabularPreview, infer_type
    if not order:
        return preview
    fields = dict(zip(order, preview.headers))
    normalized = annotation_rows(preview.headers, preview.rows, fields)
    rows = [list(row) for row in preview.rows]
    for row, item in zip(rows, normalized):
        for role in ('start', 'end'):
            row[preview.headers.index(fields[role])] = date.fromisoformat(item[role]) if item[role] is not None else None
    columns = []
    for index, field in enumerate(preview.fields):
        value = rows[0][index]
        kind = infer_type(_value(value), value, field.name) if isinstance(value, str) else field.type
        if field.name == fields['label']:
            kind = 'string'
            for row, item in zip(rows, normalized):
                row[index] = item['label']
        if field.name in {fields['start'], fields['end']}:
            kind = 'date'
        columns.append(Column(field.name, kind))
    return TabularPreview(preview.headers, rows, columns, preview.raw_rows)


class Filter(BaseModel):
    field: str
    op: str
    value: object = None


class ViewQuery(BaseModel):
    snapshot_id: str | None = None
    fields: list[str]
    filters: list[Filter] = []
    limit: int = Field(default=100, ge=1, le=settings.max_result_rows)
    offset: int = Field(default=0, ge=0)
    dimension: str | None = None
    dimensions: list[str] = Field(default_factory=list, max_length=32)
    measure: str | None = None
    aggregation: str | None = None
    metric_aggregations: dict[str, str] = Field(default_factory=dict)
    sort_measure: str | None = None
    sort: str = 'none'
    measures: list[str] = Field(default_factory=list, max_length=32)
    second_measure: str | None = None
    second_dimension: str | None = None
    chart_type: str | None = None
    metric_expression: str | None = Field(default=None, max_length=2000)
    distinct: bool = False


def snapshot_path(snapshot: DatasetSnapshot) -> str:
    original = Path(snapshot.storage_uri)
    managed = dataset_dir(snapshot.dataset_id) / 'snapshots' / f'{snapshot.id}.parquet'
    if managed.is_file():
        return str(managed)
    local = settings.snapshot_root / PureWindowsPath(snapshot.storage_uri).name
    return str(local) if not original.is_file() and local.is_file() else snapshot.storage_uri


@lru_cache(maxsize=256)
def file_fingerprint(path: str, size: int, modified: int) -> str:
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def dataset_payload(dataset: Dataset, snapshot: DatasetSnapshot) -> dict:
    arrow_schema = pq.read_schema(snapshot_path(snapshot))
    metadata = arrow_schema.metadata or {}
    formats = {}
    for field in snapshot.schema_json:
        kind = ('integer' if pa.types.is_integer(arrow_schema.field(field['name']).type) else 'decimal') if field['type'] in {'number', 'integer'} else 'text'
        formats[field['name']] = field.get('display', {'kind': kind, 'format': 'number', 'decimals': 0 if kind == 'integer' else 1})
    result = {"id": dataset.id, "name": dataset.name, "snapshot_id": snapshot.id, "row_count": snapshot.row_count, "schema": [{"name": f['name'], "type": f['type'], "display_name": f.get('display_name', f['name'])} for f in snapshot.schema_json], "field_formats": formats, "version": dataset.version, "data_as_of": snapshot.created_at.replace(tzinfo=timezone.utc).isoformat(), "import_method": metadata.get(b'import_method', b'').decode() or None, "filename": metadata.get(b'filename', b'').decode() or None, 'storage_path': f'datasets/{dataset.id}/dataset.json'}
    result['annotation_fields'] = {field['annotation_role']: field['name'] for field in snapshot.schema_json if field.get('annotation_role')}
    with SessionLocal() as session:
        source = session.get(DynamicSource, dataset.id)
        if source:
            from ..dynamic import utc_iso, fingerprint
            try:
                result['fingerprint'] = fingerprint(source.config)
            except HTTPException:
                result['fingerprint'] = None
            result['dynamic'] = {'duration_seconds': source.duration_seconds, 'last_run_at': utc_iso(source.last_run_at), 'next_run_at': utc_iso(source.next_run_at), 'last_error': source.last_error, 'schedule': source.schedule, 'refreshing': bool(source.lease_token)}
        else:
            path = snapshot_path(snapshot)
            stat = Path(path).stat()
            result['fingerprint'] = file_fingerprint(path, stat.st_size, stat.st_mtime_ns)
    return result



def table_for_preview(preview):
    columns = {field.name: [row[index] if index < len(row) else None for row in preview.rows] for index, field in enumerate(preview.fields)}
    arrays = {}
    for field, values in columns.items():
        try:
            arrays[field] = pa.array(values)
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            arrays[field] = pa.array([None if value is None else str(value) for value in values], type=pa.string())
    return pa.table(arrays)


def publish(name: str, preview, import_method: str = 'paste', filename: str | None = None, formats: dict | None = None, dataset_id: str | None = None, version: int | None = None, identity: str | None = None, on_publish=None, annotation_fields: dict | None = None) -> dict:
    previous_fields = {}
    if dataset_id:
        existing, previous = get_pair(dataset_id)
        if existing.version != version:
            raise HTTPException(409, '数据集已被修改，请重新打开字段配置后再试')
        previous_fields = {field['name']: field for field in previous.schema_json}
    if annotation_fields is None:
        annotation_fields = {field['annotation_role']: field['name'] for field in previous_fields.values() if field.get('annotation_role')}
    if annotation_fields:
        annotation_rows(preview.headers, preview.rows, annotation_fields)
    displays = infer_formats(preview)
    types = {field.name: field.type for field in preview.fields}
    for field in preview.fields:
        old = previous_fields.get(field.name, {})
        if old.get('type') == field.type and old.get('display'):
            displays[field.name] = old['display']
    for field, display in (formats or {}).items():
        validated = display if isinstance(display, DisplayUpdate) else DisplayUpdate.model_validate(display)
        if not ((types.get(field) in {'number', 'integer'} and validated.kind != 'text' and validated.dateFormat is None and validated.valueLabels is None) or (types.get(field) in {'string', 'date'} and validated.kind == 'text' and (validated.valueLabels is not None or validated.dateFormat is not None) and (types.get(field) == 'date' or validated.dateFormat is None))):
            raise ValueError('显示格式与字段类型不匹配')
        displays[field] = {**displays[field], **validated.model_dump(exclude_none=True)}
    table = table_for_preview(preview).replace_schema_metadata({b'import_method': import_method.encode(), b'filename': (filename or '').encode()})
    identity = dataset_id or identity or str(uuid4())
    snapshot_id = str(uuid4())
    root = dataset_dir(identity) / 'snapshots'
    root.mkdir(parents=True, exist_ok=True)
    candidate = root / f'.{snapshot_id}.parquet.tmp'
    published = root / f'{snapshot_id}.parquet'
    try:
        pq.write_table(table, candidate)
        if pq.read_metadata(candidate).num_rows != len(preview.rows):
            raise ValueError("Snapshot row count validation failed")
        candidate.replace(published)
        with ExitStack() as files, SessionLocal.begin() as session:
            dataset = session.get(Dataset, dataset_id) if dataset_id else Dataset(id=identity, name=name)
            if not dataset_id:
                session.add(dataset); session.flush()
            schema = []
            for field in preview.fields:
                schema.append({'name': field.name, 'type': field.type, 'display': displays[field.name], 'display_name': previous_fields.get(field.name, {}).get('display_name', field.name), 'annotation_role': next((role for role, name in annotation_fields.items() if name == field.name), None)})
            snapshot = DatasetSnapshot(id=snapshot_id, dataset_id=dataset.id, schema_json=schema, row_count=len(preview.rows), storage_uri=str(published.resolve()))
            session.add(snapshot); session.flush()
            if dataset_id:
                result = session.execute(update(Dataset).where(Dataset.id == dataset_id, Dataset.version == version).values(name=name, version=Dataset.version + 1, current_snapshot_id=snapshot.id))
                if result.rowcount != 1:
                    raise HTTPException(409, '数据集已被修改，请重新打开字段配置后再试')
            else:
                dataset.current_snapshot_id = snapshot.id
            files.enter_context(rollback_files([dataset_dir(identity) / 'dataset.json']))
            if on_publish:
                on_publish(session, dataset, snapshot, files)
            write_dataset(identity, session)
            result = dataset_payload(dataset, snapshot)
    except Exception:
        candidate.unlink(missing_ok=True); published.unlink(missing_ok=True)
        raise
    return result


@router.post("/imports/paste", status_code=201)
def import_paste(request: PasteImport) -> dict:
    if len(request.text.encode('utf-8')) > settings.max_upload_bytes:
        raise HTTPException(413, 'Input is too large')
    preview = annotation_preview(parse_delimited(request.text, request.delimiter, request.has_header), request.annotation_order)
    return preview_payload(preview) if request.preview else publish(request.name, convert_preview(preview, request.overrides, request.renames, request.field_order, request.confirm_conversion, request.formats, request.annotation_fields), formats=request.formats, dataset_id=request.dataset_id, version=request.version, annotation_fields=request.annotation_fields)


@router.post("/imports/files", status_code=201)
async def import_file(name: str = Form(...), file: UploadFile = File(...), sheet: str | None = Form(None), preview: bool = Form(False), overrides: str = Form('{}'), renames: str = Form('{}'), formats: str = Form('{}'), encoding: str = Form('utf-8-sig'), delimiter: str = Form(''), has_header: bool = Form(True), field_order: str = Form('[]'), dataset_id: str | None = Form(None), version: int | None = Form(None), confirm_conversion: bool = Form(False), annotation_fields: str = Form('{}'), annotation_order: str = Form('[]')) -> dict:
    suffix = (file.filename or "").lower().rsplit(".", 1)[-1]
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, "File is too large")
    if suffix == "csv":
        if encoding not in {'utf-8-sig', 'gb18030', 'utf-16', 'cp1252'}:
            raise HTTPException(422, 'Unsupported CSV encoding')
        parsed = parse_delimited(content.decode(encoding), delimiter or None, has_header)
    elif suffix in {"xls", "xlsx"}:
        parsed = read_workbook(content, suffix, sheet, preview, has_header)
        if isinstance(parsed, dict):
            return parsed
    else:
        raise HTTPException(415, "Only CSV, XLS, and XLSX files are supported")
    order = json.loads(field_order)
    if not isinstance(order, list) or any(not isinstance(field, str) for field in order):
        raise ValueError('Field order must be a list of field names')
    displays = json.loads(formats)
    parsed = annotation_preview(parsed, TypeAdapter(list[str]).validate_json(annotation_order))
    annotations = TypeAdapter(dict[str, str]).validate_json(annotation_fields)
    return preview_payload(parsed) if preview else publish(name, convert_preview(parsed, json.loads(overrides), json.loads(renames), order, confirm_conversion, displays, annotations), 'upload', file.filename, displays, dataset_id, version, annotation_fields=annotations)


def get_pair(dataset_id: str):
    with SessionLocal() as session:
        dataset = session.get(Dataset, dataset_id)
        if not dataset or not dataset.current_snapshot_id:
            raise HTTPException(404, "Dataset not found")
        snapshot = session.get(DatasetSnapshot, dataset.current_snapshot_id)
        if not snapshot or snapshot.status != 'SUCCEEDED':
            raise HTTPException(410, 'Dataset snapshot is unavailable')
        return dataset, snapshot


@router.get('/datasets/latest')
def latest_dataset():
    with SessionLocal() as session:
        pair = session.execute(select(Dataset, DatasetSnapshot).join(DatasetSnapshot, Dataset.current_snapshot_id == DatasetSnapshot.id).where(DatasetSnapshot.status == 'SUCCEEDED').order_by(DatasetSnapshot.created_at.desc(), DatasetSnapshot.id.desc()).limit(1)).first()
        return dataset_payload(*pair) if pair else None


@router.get('/datasets/saved')
def saved_datasets():
    with SessionLocal() as session:
        ids = set()
        for document in session.scalars(select(Dashboard.document)):
            ids.update(source['id'] for source in document.get('datasets', []) if source.get('id'))
            ids.update(chart['datasetId'] for chart in document.get('charts', []) if chart.get('datasetId'))
        pairs = session.execute(select(Dataset, DatasetSnapshot).join(DatasetSnapshot, Dataset.current_snapshot_id == DatasetSnapshot.id).where(Dataset.id.in_(ids), DatasetSnapshot.status == 'SUCCEEDED').order_by(Dataset.name, Dataset.id))
        return [dataset_payload(*pair) for pair in pairs]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    return dataset_payload(*get_pair(dataset_id))


@router.get('/datasets')
def list_datasets():
    with SessionLocal() as session:
        return [dataset_payload(item, session.get(DatasetSnapshot, item.current_snapshot_id)) for item in session.scalars(select(Dataset)) if item.current_snapshot_id]


@router.delete('/datasets/{dataset_id}', status_code=204)
def delete_dataset(dataset_id: str, confirm_references: bool = False):
    from datetime import datetime
    import shutil
    with SessionLocal.begin() as session:
        item = session.get(Dataset, dataset_id)
        if not item:
            raise HTTPException(404, 'Dataset not found')
        for model in (Dashboard, PublishedDashboard):
            for report in session.scalars(select(model)):
                document = report.document
                if any(chart.get('datasetId') == dataset_id for chart in document.get('charts', [])) or any(source.get('id') == dataset_id for source in document.get('datasets', [])):
                    if not confirm_references:
                        raise HTTPException(409, '数据集正被报表使用，请确认删除')
        source = session.get(DynamicSource, dataset_id)
        if source:
            now = datetime.now(timezone.utc)
            locked = session.execute(update(DynamicSource).where(DynamicSource.dataset_id == dataset_id, or_(DynamicSource.lease_until.is_(None), DynamicSource.lease_until <= now)).values(lease_token=str(uuid4()), lease_until=now))
            if locked.rowcount != 1:
                raise HTTPException(409, '数据集正在刷新，请稍后再试')
        session.execute(delete(DynamicSource).where(DynamicSource.dataset_id == dataset_id))
        session.execute(delete(DatasetSnapshot).where(DatasetSnapshot.dataset_id == dataset_id))
        session.delete(item)
    root = dataset_dir(dataset_id)
    if root.exists():
        shutil.rmtree(root)


@router.get('/datasets/{dataset_id}/references')
def dataset_references(dataset_id: str):
    with SessionLocal() as session:
        if not session.get(Dataset, dataset_id):
            raise HTTPException(404, 'Dataset not found')
        references = []
        seen = set()
        for model in (Dashboard, PublishedDashboard):
            for report in session.scalars(select(model).order_by(model.name, model.id)):
                charts = [chart for chart in report.document.get('charts', []) if chart.get('datasetId') == dataset_id]
                if not charts and any(source.get('id') == dataset_id for source in report.document.get('datasets', [])):
                    charts = [{}]
                for chart in charts:
                    title = chart.get('config', {}).get('title', '')
                    key = (report.id, chart.get('id'), title)
                    if key not in seen:
                        seen.add(key)
                        references.append({'report_id': report.id, 'report_name': report.name, 'chart_id': chart.get('id'), 'chart_title': title})
        return references


@router.get('/datasets/{dataset_id}/source')
def dataset_source(dataset_id: str) -> dict:
    dataset, snapshot = get_pair(dataset_id)
    output = StringIO()
    writer = csv.writer(output, delimiter='\t', lineterminator='\n')
    names = [field['name'] for field in snapshot.schema_json]
    writer.writerow(names)
    with query_slots, pq.ParquetFile(snapshot_path(snapshot)) as parquet:
        for batch in parquet.iter_batches(batch_size=65536, columns=names):
            for row in batch.to_pylist():
                writer.writerow(['\\N' if row[name] is None else row[name] for name in names])
            if output.tell() > settings.max_upload_bytes:
                raise HTTPException(413, '数据集过大，请通过本地文件重新导入')
    text = output.getvalue()
    if len(text.encode('utf-8')) > settings.max_upload_bytes:
        raise HTTPException(413, '数据集过大，请通过本地文件重新导入')
    return {'text': text, 'version': dataset.version}


class FieldFormatUpdate(BaseModel):
    field: str = Field(min_length=1)
    format: Literal['number', 'percent']
    decimals: int = Field(ge=0, le=4, strict=True)
    version: int = Field(ge=1)


class FieldsUpdate(BaseModel):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    types: dict[str, Literal['string', 'number', 'integer', 'date']] = Field(default_factory=dict)
    formats: dict[str, DisplayUpdate] = Field(default_factory=dict)
    field_order: list[str] = Field(default_factory=list)
    display_names: dict[str, str] = Field(default_factory=dict)
    annotation_fields: dict[str, str] | None = None
    confirm_conversion: bool = False


@router.patch('/datasets/{dataset_id}/fields')
def update_fields(dataset_id: str, request: FieldsUpdate) -> dict:
    from ..imports.delimited import Field as Column, TabularPreview
    if request.name is not None and not request.name.strip():
        raise HTTPException(422, '数据集名称不能为空')
    dataset, snapshot = get_pair(dataset_id)
    if dataset.version != request.version:
        raise HTTPException(409, '数据集已被修改，请取消并重新打开预览后再试')
    fields = {field['name']: field['type'] for field in snapshot.schema_json}
    if request.field_order and (len(request.field_order) != len(set(request.field_order)) or not set(request.field_order).issubset(fields)):
        raise HTTPException(422, 'Field order must contain valid unique fields')
    kept_fields = request.field_order or list(fields)
    if not (request.types.keys() | request.formats.keys() | request.display_names.keys()) <= fields.keys():
        raise HTTPException(422, 'Unknown field')
    if any(not name.strip() or len(name.strip()) > 255 for name in request.display_names.values()):
        raise HTTPException(422, '展示名称不能为空，且不能超过 255 个字符')
    types = {**fields, **request.types}
    if any(not ((types[name] in {'number', 'integer'} and display.kind != 'text' and display.dateFormat is None and display.valueLabels is None) or (types[name] in {'string', 'date'} and display.kind == 'text' and (display.valueLabels is not None or display.dateFormat is not None) and (types[name] == 'date' or display.dateFormat is None))) for name, display in request.formats.items()):
        raise HTTPException(422, '显示格式与字段类型不匹配')
    changed_types = {name: kind for name, kind in types.items() if kind != fields[name]}
    review_types = {**changed_types, **{name: 'integer' for name, display in request.formats.items() if display.kind == 'integer'}}
    if review_types and not request.confirm_conversion:
        issues = {}
        with query_slots, pq.ParquetFile(snapshot_path(snapshot)) as parquet:
            for batch in parquet.iter_batches(batch_size=65536, columns=list(review_types)):
                for name, kind in review_types.items():
                    values = batch.column(name).to_pylist()
                    if request.annotation_fields and name in {request.annotation_fields.get('start'), request.annotation_fields.get('end')}:
                        values = [None if isinstance(value, str) and value.strip().upper() in {'', 'NULL', '[NULL]', '\\N'} else value for value in values]
                    preview = TabularPreview([name], [[value] for value in values], [Column(name, fields[name])])
                    try:
                        convert_preview(preview, {name: kind}, formats=request.formats)
                    except HTTPException as error:
                        if not isinstance(error.detail, dict) or error.detail.get('code') != 'type_conversion_required':
                            raise
                        for issue in error.detail['fields']:
                            previous = issues.setdefault(issue['field'], issue)
                            previous['examples'] = list(dict.fromkeys([*previous['examples'], *issue['examples']]))[:3]
        if issues:
            raise HTTPException(422, detail={'code': 'type_conversion_required', 'fields': list(issues.values())})
    annotation_fields = request.annotation_fields if request.annotation_fields is not None else {field['annotation_role']: field['name'] for field in snapshot.schema_json if field.get('annotation_role')}
    if annotation_fields:
        annotation_rows(kept_fields, [], annotation_fields)
        with query_slots, pq.ParquetFile(snapshot_path(snapshot)) as parquet:
            for batch in parquet.iter_batches(batch_size=65536, columns=kept_fields):
                annotation_rows(kept_fields, [[row[name] for name in kept_fields] for row in batch.to_pylist()], annotation_fields)
    formats = dataset_payload(dataset, snapshot)['field_formats']
    for name, kind in changed_types.items():
        formats[name] = {'kind': 'integer' if kind == 'integer' else 'decimal' if kind == 'number' else 'text', 'format': 'number', 'decimals': 0 if kind == 'integer' else 1}
    for name, display in request.formats.items():
        formats[name] = {**formats[name], **display.model_dump(exclude_none=True)}
    if len(kept_fields) < len(fields):
        with query_slots:
            table = pq.read_table(snapshot_path(snapshot), columns=kept_fields)
        metadata = table.schema.metadata or {}
        preview = TabularPreview(kept_fields, [[row[name] for name in kept_fields] for row in table.to_pylist()], [Column(name, types[name]) for name in kept_fields])
        displays = {name: formats[name] for name in kept_fields if types[name] in {'number', 'integer'} or formats[name].get('dateFormat') or formats[name].get('valueLabels') is not None}
        def on_publish(session, item, updated, files):
            updated.schema_json = [{**field, 'display_name': request.display_names.get(field['name'], field['display_name']).strip()} for field in updated.schema_json]
            source = session.get(DynamicSource, dataset_id)
            if source:
                previous = source.config.get('field_settings', {})
                originals = {name.strip(): original for original, name in previous.get('renames', {}).items()}
                settings = {
                    'overrides': {originals.get(field.name, field.name): field.type for field in preview.fields},
                    'renames': {originals.get(name, name): name for name in kept_fields},
                    'field_order': [originals.get(name, name) for name in kept_fields],
                    'formats': displays,
                    'confirm_conversion': previous.get('confirm_conversion', False) or request.confirm_conversion,
                }
                source.config = {**source.config, 'annotation_fields': annotation_fields, 'field_settings': settings}
        return publish(request.name.strip() if request.name is not None else dataset.name, preview, metadata.get(b'import_method', b'paste').decode(), metadata.get(b'filename', b'').decode() or None, displays, dataset_id, request.version, on_publish=on_publish, annotation_fields=annotation_fields)
    schema_json = [{**field, 'type': types[field['name']], 'display': formats[field['name']], 'display_name': request.display_names.get(field['name'], field.get('display_name', field['name'])).strip()} for field in snapshot.schema_json]
    schema_json = [{**field, 'annotation_role': next((role for role, name in annotation_fields.items() if name == field['name']), None)} for field in schema_json]
    if request.field_order:
        positions = {name: index for index, name in enumerate(request.field_order)}
        schema_json.sort(key=lambda field: (False if annotation_fields else field['type'] in {'number', 'integer'}, positions[field['name']]))
    with ExitStack() as files, SessionLocal.begin() as session:
        result = session.execute(update(Dataset).where(Dataset.id == dataset_id, Dataset.version == request.version, Dataset.current_snapshot_id == snapshot.id).values(version=Dataset.version + 1, name=request.name.strip() if request.name is not None else dataset.name))
        if result.rowcount != 1:
            raise HTTPException(409, 'Dataset has changed; reopen field settings and try again')
        files.enter_context(rollback_files([dataset_dir(dataset_id) / 'dataset.json']))
        session.get(DatasetSnapshot, snapshot.id).schema_json = schema_json
        source = session.get(DynamicSource, dataset_id)
        if source and request.annotation_fields is not None:
            source.config = {**source.config, 'annotation_fields': annotation_fields}
        if source and source.config.get('field_settings'):
            field_settings = {**source.config['field_settings']}
            originals = {name.strip(): original for original, name in field_settings['renames'].items()}
            field_settings['overrides'] = {originals.get(field['name'], field['name']): field['type'] for field in schema_json}
            field_settings['field_order'] = [originals.get(field['name'], field['name']) for field in schema_json]
            field_settings['formats'] = formats
            field_settings['confirm_conversion'] = field_settings['confirm_conversion'] or request.confirm_conversion
            source.config = {**source.config, 'field_settings': field_settings}
        result = dataset_payload(session.get(Dataset, dataset_id), session.get(DatasetSnapshot, snapshot.id))
        write_dataset(dataset_id, session)
    return result



@router.patch('/datasets/{dataset_id}/field-format')
def update_field_format(dataset_id: str, request: FieldFormatUpdate) -> dict:
    return update_fields(dataset_id, FieldsUpdate(version=request.version, formats={request.field: DisplayUpdate(format=request.format, decimals=request.decimals)}))


@router.post("/datasets/{dataset_id}/view-query")
def view_query(dataset_id: str, request: ViewQuery) -> dict:
    if request.snapshot_id:
        with SessionLocal() as session:
            snapshot = session.get(DatasetSnapshot, request.snapshot_id)
            if not snapshot or snapshot.dataset_id != dataset_id or snapshot.status != 'SUCCEEDED':
                raise HTTPException(410, 'Dataset snapshot is unavailable')
    else:
        _, snapshot = get_pair(dataset_id)
    allowed = {field["name"] for field in snapshot.schema_json}
    if not request.fields or not set(request.fields).issubset(allowed):
        raise HTTPException(422, "Unknown field")
    if any(field and field not in allowed for field in [request.measure, request.dimension, request.second_measure, request.second_dimension, *request.measures, *request.dimensions]):
        raise HTTPException(422, 'Unknown chart field')
    types = {field['name']: field['type'] for field in snapshot.schema_json}
    if any(name and types[name] not in {'string', 'date'} for name in [request.dimension, request.second_dimension, *request.dimensions]):
        raise HTTPException(422, 'Dimensions require text or date fields')
    if any(name and types[name] not in {'number', 'integer'} for name in [request.measure, request.second_measure, *request.measures]):
        raise HTTPException(422, 'Measures require numeric fields')
    quote = lambda name: '"' + name.replace('"', '""') + '"'
    conditions, parameters = [], []
    for item in request.filters:
        if item.field not in allowed:
            raise HTTPException(422, "Unknown filter field")
        column = quote(item.field)
        if item.op in {"between", "date_between"} and isinstance(item.value, list) and len(item.value) == 2:
            if item.op == 'date_between' or types[item.field] == 'date':
                column = f'TRY_CAST({column} AS DATE)'
            conditions.append(f"{column} BETWEEN ? AND ?"); parameters.extend(item.value)
        elif item.op == "eq":
            conditions.append(f"{column} = ?"); parameters.append(item.value)
        elif item.op == "contains":
            conditions.append(f"CAST({column} AS VARCHAR) ILIKE ?"); parameters.append(f"%{item.value}%")
        elif item.op == "in" and isinstance(item.value, list) and item.value:
            values = [value for value in item.value if value is not None]
            parts = [f"{column} IN ({','.join('?' for _ in values)})"] if values else []
            if None in item.value:
                parts.append(f"{column} IS NULL")
            conditions.append('(' + ' OR '.join(parts) + ')'); parameters.extend(values)
        elif item.op == "is_null":
            conditions.append(f"{column} IS NULL")
        else:
            raise HTTPException(422, "Unsupported filter")
    source = 'read_parquet(?)'
    if request.chart_type and request.chart_type != 'table':
        arrow_schema = pq.read_schema(snapshot_path(snapshot))
        interpreted = []
        for name, kind in types.items():
            original = arrow_schema.field(name).type
            column = quote(name)
            if kind in {'number', 'integer'} and not (pa.types.is_integer(original) or pa.types.is_floating(original) or pa.types.is_decimal(original)):
                column = f'TRY_CAST({column} AS DOUBLE)'
            elif kind == 'date' and not pa.types.is_date(original):
                column = f'TRY_CAST({column} AS DATE)'
            elif kind == 'string' and not pa.types.is_string(original):
                column = f'CAST({column} AS VARCHAR)'
            interpreted.append(column + ' AS ' + quote(name))
        source = '(SELECT ' + ','.join(interpreted) + ' FROM read_parquet(?))'
    projection = ','.join(map(quote, request.fields))
    group = ' GROUP BY ' + projection if request.distinct else ''
    if request.chart_type == 'date-range':
        if len(request.fields) != 1 or types[request.fields[0]] not in {'string', 'date'}:
            raise HTTPException(422, 'Date ranges require a text or date field')
        field = f'TRY_CAST({quote(request.fields[0])} AS DATE)'
        projection = f'MIN({field}) AS __start, MAX({field}) AS __end'
        group = ''
    if request.aggregation:
        if request.aggregation not in {'sum', 'avg', 'count', 'min', 'max', 'count_distinct'} or request.measure not in allowed or (request.dimension and request.dimension not in allowed):
            raise HTTPException(422, 'Invalid aggregation')
        if any(field not in allowed or method not in {'sum', 'avg', 'count', 'min', 'max', 'count_distinct'} for field, method in request.metric_aggregations.items()):
            raise HTTPException(422, 'Invalid metric aggregation')
        aggregation = request.metric_aggregations.get(request.measure, request.aggregation)
        metric = compile_expression(request.metric_expression, allowed) if request.metric_expression else quote(request.measure)
        expression = f'COUNT(DISTINCT {metric})' if aggregation == 'count_distinct' else f'{aggregation.upper()}({metric})'
        dimensions = list(dict.fromkeys([*(request.dimensions or ([request.dimension] if request.dimension else [])), *([request.second_dimension] if request.second_dimension else [])]))
        dimension_sql = ','.join(map(quote, dimensions))
        projection = (dimension_sql + ',' if dimensions else '') + expression + ' AS ' + quote(request.measure)
        group = ' GROUP BY ' + dimension_sql if dimensions else ''
        for field in dict.fromkeys([*request.measures, request.second_measure]):
            if not field or field == request.measure:
                continue
            second = quote(field)
            aggregation = request.metric_aggregations.get(field, request.aggregation)
            expression2 = f'COUNT(DISTINCT {second})' if aggregation == 'count_distinct' else f'{aggregation.upper()}({second})'
            projection += ', ' + expression2 + ' AS ' + second
    if request.chart_type == 'candlestick':
        if not request.dimension or len(request.measures) != 4 or len(set(request.measures)) != 4 or any(types.get(field) not in {'number', 'integer'} for field in request.measures):
            raise HTTPException(422, '蜡烛图需要四个不同的数值字段')
        candle_order = '__dw_candle_order'
        while candle_order in allowed:
            candle_order += '_'
        source = f'(SELECT *, row_number() OVER () AS {quote(candle_order)} FROM {source})'
        opening, closing, low, high = map(quote, request.measures)
        projection = f'{quote(request.dimension)}, FIRST({opening} ORDER BY {quote(candle_order)}) AS {opening}, LAST({closing} ORDER BY {quote(candle_order)}) AS {closing}, MIN({low}) AS {low}, MAX({high}) AS {high}'
        group = ' GROUP BY ' + quote(request.dimension)
    if request.chart_type == 'boxplot':
        if not request.dimension or not request.measure:
            raise HTTPException(422, 'Boxplot requires a dimension and numeric measure')
        projection = quote(request.dimension) + ', quantile_cont(' + quote(request.measure) + ', [0, 0.25, 0.5, 0.75, 1]) AS __box'
        group = ' GROUP BY ' + quote(request.dimension)
    order = ''
    sort_measure = request.sort_measure or request.measure
    if request.sort_measure and request.sort_measure not in [request.measure, *request.measures, request.second_measure]:
        raise HTTPException(422, 'Invalid sort measure')
    if request.sort in {'asc', 'desc'} and sort_measure in allowed and request.chart_type != 'boxplot':
        order = f' ORDER BY {quote(sort_measure)} {request.sort.upper()}'
        if request.aggregation and request.second_dimension and request.chart_type in {'bar', 'line', 'area', 'mixed'}:
            axis_dimensions = request.dimensions or ([request.dimension] if request.dimension else [])
            if axis_dimensions:
                method = request.metric_aggregations.get(sort_measure, request.aggregation)
                value = compile_expression(request.metric_expression, allowed) if sort_measure == request.measure and request.metric_expression else quote(sort_measure)
                aggregate = f'COUNT(DISTINCT {value})' if method == 'count_distinct' else f'{method.upper()}({value})'
                order = f' ORDER BY SUM({aggregate}) OVER (PARTITION BY {",".join(map(quote, axis_dimensions))}) {request.sort.upper()}'
    if group and not order:
        order_field = '__dw_row_order'
        while order_field in allowed:
            order_field += '_'
        source = f'(SELECT *, row_number() OVER () AS {quote(order_field)} FROM {source})'
        order = f' ORDER BY MIN({quote(order_field)})'
    sql = f"SELECT {projection} FROM {source}" + (" WHERE " + " AND ".join(conditions) if conditions else "") + group + order + " LIMIT ? OFFSET ?"
    if request.chart_type == 'histogram':
        if not request.measure:
            raise HTTPException(422, 'Histogram requires a numeric measure')
        where = ' WHERE ' + ' AND '.join([*conditions, quote(request.measure) + ' IS NOT NULL'])
        sql = f'''WITH source AS (SELECT {quote(request.measure)} AS v FROM {source} {where}),
          stats AS (SELECT min(v) AS lo, max(v) AS hi, least(100, greatest(1, ceil(sqrt(count(*))))) AS n FROM source),
          bins AS (SELECT least(n-1, floor((v-lo)/CASE WHEN hi=lo THEN 1 ELSE (hi-lo)/n END)) AS idx, lo,
            CASE WHEN hi=lo THEN 1 ELSE (hi-lo)/n END AS width FROM source CROSS JOIN stats)
          , counts AS (SELECT idx, count(*) AS freq FROM bins GROUP BY idx)
          SELECT lo + grid.i * CASE WHEN hi=lo THEN 1 ELSE (hi-lo)/n END AS __bin,
            coalesce(counts.freq, 0) AS __count FROM stats
          CROSS JOIN LATERAL range(n::BIGINT) AS grid(i) LEFT JOIN counts ON counts.idx=grid.i
          WHERE lo IS NOT NULL ORDER BY __bin LIMIT ? OFFSET ?'''
    with query_slots, duckdb.connect() as connection:
        connection.execute("SET memory_limit='512MB'")
        connection.execute('SET threads=2')
        timer = Timer(settings.query_timeout_seconds, connection.interrupt)
        timer.daemon = True
        timer.start()
        try:
            cursor = connection.execute(sql, [snapshot_path(snapshot), *parameters, request.limit, request.offset])
            columns = [item[0] for item in cursor.description]
            rows = [dict(zip(columns, values)) for values in cursor.fetchall()]
        finally:
            timer.cancel()
            timer.join()
    if request.chart_type == 'annotation':
        fields = {field['annotation_role']: field['name'] for field in snapshot.schema_json if field.get('annotation_role')}
        rows = annotation_rows(request.fields, [[row[name] for name in request.fields] for row in rows], fields)
    return {"snapshot_id": snapshot.id, "data_as_of": snapshot.created_at.replace(tzinfo=timezone.utc).isoformat(), "is_sampled": False, "scope": {"limit": request.limit}, "columns": request.fields, "rows": rows}
