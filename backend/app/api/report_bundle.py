"""Report export/import as a zip: the report document, every dataset it uses, static data and dynamic source settings."""
import io
import json
import threading
import zipfile
from contextlib import ExitStack
from urllib.parse import quote
from uuid import UUID, uuid4

import pyarrow.parquet as pq
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..db import SessionLocal
from ..dynamic import Schedule, next_run, refresh
from ..models import Dataset, DatasetSnapshot, DynamicSource, SavedConnection
from ..settings import settings
from ..storage import dataset_dir, dataset_manifest_path, rollback_files, write_dataset
from .dashboards import SaveDashboard, create_dashboard
from .datasets import get_pair, snapshot_path

router = APIRouter(prefix='/api/dashboards')
FORMAT = 'mybi-report'
DYNAMIC_KEYS = {'connection_id', 'redshift', 'host', 'port', 'database', 'user', 'tls', 'trust_server_certificate', 'mode', 'sql', 'schema_name', 'object_name', 'field_settings', 'annotation_fields', 'annotation_merge', 'sync_requires_connection'}


class ExportReport(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    document: dict


def dataset_ids(document: dict) -> list[str]:
    return list(dict.fromkeys([chart['datasetId'] for chart in document.get('charts', []) if chart.get('datasetId')] + [source['id'] for source in document.get('datasets', []) if isinstance(source, dict) and source.get('id')]))


@router.post('/export')
def export_report(body: ExportReport):
    document = {key: value for key, value in body.document.items() if key != '_mybi'}
    entries = []
    # shortcut: the zip is built in memory; stream it from a temp file if reports with very large static datasets appear.
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source_id in dataset_ids(document):
            try:
                dataset, snapshot = get_pair(source_id)
            except HTTPException as error:
                if error.status_code in (404, 410):
                    continue
                raise
            with SessionLocal() as session:
                source = session.get(DynamicSource, source_id)
                connection = session.get(SavedConnection, source.config['connection_id']) if source and source.config.get('connection_id') else None
            path = snapshot_path(snapshot)
            entry = {'id': source_id, 'name': dataset.name, 'schema': snapshot.schema_json, 'kind': 'dynamic' if source else 'static'}
            if source:
                # Settings only, never the password; the data is fetched again after import.
                entry['dynamic'] = {'config': {key: value for key, value in source.config.items() if key != 'password'}, 'schedule': source.schedule, 'connection_name': connection.name if connection else None}
                table = pq.read_schema(path).empty_table()
                data = io.BytesIO(); pq.write_table(table, data)
                archive.writestr(f'datasets/{source_id}.parquet', data.getvalue())
            else:
                archive.write(path, f'datasets/{source_id}.parquet')
            entries.append(entry)
        archive.writestr('report.json', json.dumps({'format': FORMAT, 'version': 1, 'name': body.name, 'document': document, 'datasets': entries}, ensure_ascii=False, indent=2))
    filename = quote(f'{body.name}.zip')
    return Response(buffer.getvalue(), media_type='application/zip', headers={'Content-Disposition': f"attachment; filename=\"report.zip\"; filename*=UTF-8''{filename}"})


def create_dataset(name: str, table, schema: list, on_create=None) -> str:
    identity, snapshot_id = str(uuid4()), str(uuid4())
    root = dataset_dir(identity) / 'snapshots'
    root.mkdir(parents=True, exist_ok=True)
    candidate, published = root / f'.{snapshot_id}.parquet.tmp', root / f'{snapshot_id}.parquet'
    try:
        pq.write_table(table, candidate)
        candidate.replace(published)
        with ExitStack() as files, SessionLocal.begin() as session:
            dataset = Dataset(id=identity, name=name)
            session.add(dataset); session.flush()
            session.add(DatasetSnapshot(id=snapshot_id, dataset_id=identity, schema_json=schema, row_count=table.num_rows, storage_uri=str(published.resolve())))
            session.flush()
            dataset.current_snapshot_id = snapshot_id
            files.enter_context(rollback_files([dataset_manifest_path(identity, session)]))
            if on_create:
                on_create(session, identity)
            write_dataset(identity, session)
    except Exception:
        candidate.unlink(missing_ok=True); published.unlink(missing_ok=True)
        raise
    return identity


def refresh_quietly(dataset_id: str):
    try:
        refresh(dataset_id, force=True)
    except Exception:
        pass  # refresh records last_error on the source; the dataset page shows it


@router.post('/import', status_code=201)
async def import_report(file: UploadFile = File(...)):
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, '文件过大')
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        bundle = json.loads(archive.read('report.json'))
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise HTTPException(422, '不是有效的 MyBI 报表导出文件') from None
    if bundle.get('format') != FORMAT or not isinstance(bundle.get('document'), dict) or not isinstance(bundle.get('datasets'), list):
        raise HTTPException(422, '不是有效的 MyBI 报表导出文件')
    ids, warnings, refreshes = {}, [], []
    for entry in bundle['datasets']:
        try:
            old_id = str(UUID(str(entry['id'])))
            table = pq.read_table(io.BytesIO(archive.read(f'datasets/{old_id}.parquet')))
            schema, name = entry['schema'], str(entry['name'])[:255]
        except (KeyError, ValueError, TypeError, OSError):
            raise HTTPException(422, '导出文件中的数据集已损坏') from None
        if not isinstance(schema, list) or [field.get('name') for field in schema] != table.column_names:
            raise HTTPException(422, '导出文件中的数据集已损坏')
        on_create = None
        if entry.get('kind') == 'dynamic':
            dynamic = entry.get('dynamic') or {}
            # Untrusted file: keep only known settings (never a password) and a valid schedule.
            config = {key: value for key, value in dict(dynamic.get('config') or {}).items() if key in DYNAMIC_KEYS}
            try:
                schedule = Schedule.model_validate(dynamic.get('schedule') or {}).model_dump()
            except ValueError:
                raise HTTPException(422, '导出文件中的数据集已损坏') from None
            with SessionLocal() as session:
                if config.get('connection_id') and not session.get(SavedConnection, config['connection_id']):
                    match = session.scalar(select(SavedConnection).where(SavedConnection.name == dynamic.get('connection_name'))) if dynamic.get('connection_name') else None
                    if match:
                        config['connection_id'] = match.id
                    else:
                        warnings.append({'dataset': name, 'code': 'connection_missing'})
            if not config.get('connection_id'):
                warnings.append({'dataset': name, 'code': 'password_required'})
            on_create = lambda session, dataset_id, config=config, schedule=schedule: session.add(DynamicSource(dataset_id=dataset_id, config=config, schedule=schedule, next_run_at=next_run(schedule)))
        new_id = create_dataset(name, table, schema, on_create)
        ids[old_id] = new_id
        if entry.get('kind') == 'dynamic':
            refreshes.append(new_id)
    text = json.dumps(bundle['document'], ensure_ascii=False)
    for old_id, new_id in ids.items():
        text = text.replace(old_id, new_id)
    report = create_dashboard(SaveDashboard(name=str(bundle.get('name') or file.filename or 'Report')[:255], document=json.loads(text)))
    for dataset_id in refreshes:
        threading.Thread(target=refresh_quietly, args=(dataset_id,), daemon=True).start()
    return {**report, 'import_warnings': warnings}
