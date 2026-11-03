from datetime import timezone
from datetime import date
import csv
from io import StringIO
from pathlib import Path
import json
import math
from threading import BoundedSemaphore, Timer
from uuid import uuid4
from typing import Literal

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update

from ..db import SessionLocal
from ..imports.delimited import parse_delimited, _value, infer_formats
from ..imports.excel import read_workbook
from ..models import Dataset, DatasetSnapshot, Dashboard
from ..settings import settings
from ..expressions import compile_expression

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


def convert_preview(preview, overrides, renames=None, field_order=None, confirm_conversion=False, formats=None):
    from ..imports.delimited import Field as Column, TabularPreview
    if field_order:
        if len(field_order) != len(preview.headers) or set(field_order) != set(preview.headers):
            raise ValueError('Field order must contain every field exactly once')
        indices = [preview.headers.index(name) for name in field_order]
        indices.sort(key=lambda index: overrides.get(preview.fields[index].name, preview.fields[index].type) in {'number', 'integer'})
        preview = TabularPreview([preview.headers[i] for i in indices], [[row[i] for i in indices] for row in preview.rows], [preview.fields[i] for i in indices], [[row[i] for i in indices] for row in preview.raw_rows] if preview.raw_rows is not None else None)
    renames = renames or {}
    names = [renames.get(field.name, field.name).strip() for field in preview.fields]
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
            try:
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
    sort: str = 'none'
    measures: list[str] = Field(default_factory=list, max_length=32)
    second_measure: str | None = None
    second_dimension: str | None = None
    chart_type: str | None = None
    metric_expression: str | None = Field(default=None, max_length=2000)
    distinct: bool = False


def snapshot_path(snapshot: DatasetSnapshot) -> str:
    original = Path(snapshot.storage_uri)
    local = settings.snapshot_root / original.name
    return str(local) if not original.is_file() and local.is_file() else snapshot.storage_uri


def dataset_payload(dataset: Dataset, snapshot: DatasetSnapshot) -> dict:
    arrow_schema = pq.read_schema(snapshot_path(snapshot))
    metadata = arrow_schema.metadata or {}
    formats = {}
    for field in snapshot.schema_json:
        kind = ('integer' if pa.types.is_integer(arrow_schema.field(field['name']).type) else 'decimal') if field['type'] in {'number', 'integer'} else 'text'
        formats[field['name']] = field.get('display', {'kind': kind, 'format': 'number', 'decimals': 0 if kind == 'integer' else 1})
    return {"id": dataset.id, "name": dataset.name, "snapshot_id": snapshot.id, "row_count": snapshot.row_count, "schema": [{"name": f['name'], "type": f['type'], "display_name": f.get('display_name', f['name'])} for f in snapshot.schema_json], "field_formats": formats, "version": dataset.version, "data_as_of": snapshot.created_at.replace(tzinfo=timezone.utc).isoformat(), "import_method": metadata.get(b'import_method', b'').decode() or None, "filename": metadata.get(b'filename', b'').decode() or None}


def publish(name: str, preview, import_method: str = 'paste', filename: str | None = None, formats: dict | None = None, dataset_id: str | None = None, version: int | None = None) -> dict:
    previous_fields = {}
    if dataset_id:
        existing, previous = get_pair(dataset_id)
        if existing.version != version:
            raise HTTPException(409, '数据集已被修改，请重新打开字段配置后再试')
        previous_fields = {field['name']: field for field in previous.schema_json}
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
    columns = {field.name: [row[index] if index < len(row) else None for row in preview.rows] for index, field in enumerate(preview.fields)}
    arrays = {}
    for field, values in columns.items():
        try:
            arrays[field] = pa.array(values)
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            arrays[field] = pa.array([None if value is None else str(value) for value in values], type=pa.string())
    table = pa.table(arrays).replace_schema_metadata({b'import_method': import_method.encode(), b'filename': (filename or '').encode()})
    settings.snapshot_root.mkdir(parents=True, exist_ok=True)
    candidate = settings.snapshot_root / f".{uuid4()}.parquet.tmp"
    published = settings.snapshot_root / f"{uuid4()}.parquet"
    try:
        pq.write_table(table, candidate)
        if pq.read_metadata(candidate).num_rows != len(preview.rows):
            raise ValueError("Snapshot row count validation failed")
        candidate.replace(published)
        with SessionLocal.begin() as session:
            dataset = session.get(Dataset, dataset_id) if dataset_id else Dataset(name=name)
            if not dataset_id:
                session.add(dataset); session.flush()
            schema = []
            for field in preview.fields:
                schema.append({'name': field.name, 'type': field.type, 'display': displays[field.name], 'display_name': previous_fields.get(field.name, {}).get('display_name', field.name)})
            snapshot = DatasetSnapshot(dataset_id=dataset.id, schema_json=schema, row_count=len(preview.rows), storage_uri=str(published.resolve()))
            session.add(snapshot); session.flush()
            if dataset_id:
                result = session.execute(update(Dataset).where(Dataset.id == dataset_id, Dataset.version == version).values(name=name, version=Dataset.version + 1, current_snapshot_id=snapshot.id))
                if result.rowcount != 1:
                    raise HTTPException(409, '数据集已被修改，请重新打开字段配置后再试')
            else:
                dataset.current_snapshot_id = snapshot.id
            return dataset_payload(dataset, snapshot)
    except Exception:
        candidate.unlink(missing_ok=True); published.unlink(missing_ok=True)
        raise


@router.post("/imports/paste", status_code=201)
def import_paste(request: PasteImport) -> dict:
    if len(request.text.encode('utf-8')) > settings.max_upload_bytes:
        raise HTTPException(413, 'Input is too large')
    preview = parse_delimited(request.text, request.delimiter, request.has_header)
    return preview_payload(preview) if request.preview else publish(request.name, convert_preview(preview, request.overrides, request.renames, request.field_order, request.confirm_conversion, request.formats), formats=request.formats, dataset_id=request.dataset_id, version=request.version)


@router.post("/imports/files", status_code=201)
async def import_file(name: str = Form(...), file: UploadFile = File(...), sheet: str | None = Form(None), preview: bool = Form(False), overrides: str = Form('{}'), renames: str = Form('{}'), formats: str = Form('{}'), encoding: str = Form('utf-8-sig'), delimiter: str = Form(''), has_header: bool = Form(True), field_order: str = Form('[]'), dataset_id: str | None = Form(None), version: int | None = Form(None), confirm_conversion: bool = Form(False)) -> dict:
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
    return preview_payload(parsed) if preview else publish(name, convert_preview(parsed, json.loads(overrides), json.loads(renames), order, confirm_conversion, displays), 'upload', file.filename, displays, dataset_id, version)


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
    if request.field_order and (len(request.field_order) != len(fields) or set(request.field_order) != set(fields)):
        raise HTTPException(422, 'Field order must contain every field exactly once')
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
                    preview = TabularPreview([name], [[value] for value in batch.column(name).to_pylist()], [Column(name, fields[name])])
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
    formats = dataset_payload(dataset, snapshot)['field_formats']
    for name, kind in changed_types.items():
        formats[name] = {'kind': 'integer' if kind == 'integer' else 'decimal' if kind == 'number' else 'text', 'format': 'number', 'decimals': 0 if kind == 'integer' else 1}
    for name, display in request.formats.items():
        formats[name] = {**formats[name], **display.model_dump(exclude_none=True)}
    schema_json = [{**field, 'type': types[field['name']], 'display': formats[field['name']], 'display_name': request.display_names.get(field['name'], field.get('display_name', field['name'])).strip()} for field in snapshot.schema_json]
    if request.field_order:
        positions = {name: index for index, name in enumerate(request.field_order)}
        schema_json.sort(key=lambda field: (field['type'] in {'number', 'integer'}, positions[field['name']]))
    with SessionLocal.begin() as session:
        result = session.execute(update(Dataset).where(Dataset.id == dataset_id, Dataset.version == request.version, Dataset.current_snapshot_id == snapshot.id).values(version=Dataset.version + 1, name=request.name.strip() if request.name is not None else dataset.name))
        if result.rowcount != 1:
            raise HTTPException(409, 'Dataset has changed; reopen field settings and try again')
        session.get(DatasetSnapshot, snapshot.id).schema_json = schema_json
        return dataset_payload(session.get(Dataset, dataset_id), session.get(DatasetSnapshot, snapshot.id))



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
    if request.aggregation:
        if request.aggregation not in {'sum', 'avg', 'count', 'min', 'max', 'count_distinct'} or request.measure not in allowed or (request.dimension and request.dimension not in allowed):
            raise HTTPException(422, 'Invalid aggregation')
        metric = compile_expression(request.metric_expression, allowed) if request.metric_expression else quote(request.measure)
        expression = f'COUNT(DISTINCT {metric})' if request.aggregation == 'count_distinct' else f'{request.aggregation.upper()}({metric})'
        dimensions = list(dict.fromkeys([*(request.dimensions or ([request.dimension] if request.dimension else [])), *([request.second_dimension] if request.second_dimension else [])]))
        dimension_sql = ','.join(map(quote, dimensions))
        projection = (dimension_sql + ',' if dimensions else '') + expression + ' AS ' + quote(request.measure)
        group = ' GROUP BY ' + dimension_sql if dimensions else ''
        for field in dict.fromkeys([*request.measures, request.second_measure]):
            if not field or field == request.measure:
                continue
            second = quote(field)
            expression2 = f'COUNT(DISTINCT {second})' if request.aggregation == 'count_distinct' else f'{request.aggregation.upper()}({second})'
            projection += ', ' + expression2 + ' AS ' + second
    if request.chart_type == 'boxplot':
        if not request.dimension or not request.measure:
            raise HTTPException(422, 'Boxplot requires a dimension and numeric measure')
        projection = quote(request.dimension) + ', quantile_cont(' + quote(request.measure) + ', [0, 0.25, 0.5, 0.75, 1]) AS __box'
        group = ' GROUP BY ' + quote(request.dimension)
    order = ''
    if request.sort in {'asc', 'desc'} and request.measure in allowed and request.chart_type != 'boxplot':
        order = f' ORDER BY {quote(request.measure)} {request.sort.upper()}'
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
    return {"snapshot_id": snapshot.id, "data_as_of": snapshot.created_at.replace(tzinfo=timezone.utc).isoformat(), "is_sampled": False, "scope": {"limit": request.limit}, "columns": request.fields, "rows": rows}
