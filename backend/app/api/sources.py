from datetime import date
import json
import os
from pathlib import Path
from uuid import uuid4
from contextlib import ExitStack

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from ..db import SessionLocal
from ..connections import resolve_connection
from ..shared_data import config_path
from ..dynamic import SourceConfig, SourceRequest, cache_day, claim, configured_preview, discard_source_preview, execute, next_run, read_source_preview, refresh, release, safe_config, save_cache, stage_source_preview, stored_config, utc_now
from ..models import Dataset, DynamicSource
from ..storage import dataset_dir, dataset_manifest_path, write_dataset, rollback_files
from .datasets import annotation_preview, dataset_payload, get_pair, preview_payload, publish

router = APIRouter(prefix='/api')


class MyQueryConnection(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    host: str = Field(max_length=255)
    port: int = Field(default=5432, ge=1, le=65535)
    database: str = Field(max_length=255)
    user: str = Field(max_length=255)
    tls: bool = True
    trust_server_certificate: bool = False
    redshift: bool = False


@router.get('/sources/myquery-connections')
def myquery_connections(request: Request):
    if not request.client or request.client.host not in {'127.0.0.1', '::1'} or request.url.hostname not in {'127.0.0.1', 'localhost', '::1'}:
        raise HTTPException(403, '仅本机可读取 MyQuery 连接配置')
    if os.name != 'nt' or not os.getenv('APPDATA'):
        return []
    path = config_path()
    try:
        if not path.is_file():
            return []
        if path.stat().st_size > 1024 * 1024:
            raise ValueError()
        content = json.loads(path.read_text(encoding='utf-8'))
        profiles = content.get('profiles', [])
        if not isinstance(profiles, list) or len(profiles) > 128:
            raise ValueError()
        return [MyQueryConnection.model_validate(profile).model_dump() for profile in profiles]
    except (OSError, ValueError, AttributeError):
        raise HTTPException(422, '无法读取 MyQuery 连接配置') from None


@router.post('/sources/validate')
def validate_source(body: SourceConfig):
    preview, duration = execute(stored_config(body))
    preview = annotation_preview(preview, body.annotation_order)
    return {**preview_payload(preview), 'duration_seconds': duration, 'validated': True}


@router.post('/sources/preview')
def preview_source(body: SourceConfig, dataset_id: str | None = None):
    with SessionLocal() as session:
        source = session.get(DynamicSource, dataset_id) if dataset_id else None
        if dataset_id and not source:
            raise HTTPException(404, '动态数据源不存在')
        config = resolve_connection(stored_config(body, source.config if source else None))
    preview, duration = execute(config)
    preview = annotation_preview(preview, body.annotation_order)
    preview_id = stage_source_preview(preview, config, duration)
    return {**preview_payload(preview), 'duration_seconds': duration, 'preview_id': preview_id}


@router.delete('/sources/previews/{preview_id}', status_code=204)
def discard_preview(preview_id: str):
    discard_source_preview(preview_id)


@router.post('/datasets/{dataset_id}/dynamic/validate')
def validate_existing(dataset_id: str, body: SourceConfig):
    with SessionLocal() as session:
        source = session.get(DynamicSource, dataset_id)
        if not source:
            raise HTTPException(404, '动态数据源不存在')
        config = stored_config(body, source.config)
    preview, duration = execute(config)
    preview = annotation_preview(preview, body.annotation_order)
    return {**preview_payload(preview), 'duration_seconds': duration, 'validated': True}


@router.post('/sources', status_code=201)
def create_source(body: SourceRequest):
    if not body.name.strip():
        raise HTTPException(422, '数据集名称不能为空')
    config = stored_config(body)
    execution_config = resolve_connection(config)
    preview, duration = read_source_preview(body.preview_id, execution_config) if body.preview_id else execute(execution_config)
    preview = configured_preview(preview, execution_config)
    schedule = body.schedule.model_dump()
    identity = str(uuid4())
    day = cache_day(schedule)
    root = dataset_dir(identity) / 'cache'
    def on_publish(session, item, snapshot, files):
        session.add(DynamicSource(dataset_id=item.id, config=config, schedule=schedule,
                                  duration_seconds=duration, last_run_at=utc_now(), next_run_at=next_run(schedule)))
        files.enter_context(rollback_files([root / f'{day}.parquet', root / f'{day}.json']))
        save_cache(snapshot, execution_config, schedule, duration, day)
    result = publish(body.name.strip(), preview, 'dynamic', formats=body.formats, identity=identity, on_publish=on_publish, annotation_fields=body.annotation_fields)
    if body.preview_id:
        discard_source_preview(body.preview_id)
    return {**dataset_payload(*get_pair(result['id'])), 'duration_seconds': duration, 'cache_hit': False}


@router.get('/datasets/{dataset_id}/dynamic')
def get_source(dataset_id: str):
    dataset, _ = get_pair(dataset_id)
    with SessionLocal() as session:
        source = session.get(DynamicSource, dataset_id)
        if not source:
            raise HTTPException(404, '动态数据源不存在')
        return {**safe_config(source), 'name': dataset.name, 'version': dataset.version}


@router.put('/datasets/{dataset_id}/dynamic')
def save_source(dataset_id: str, body: SourceRequest):
    if not body.name.strip():
        raise HTTPException(422, '数据集名称不能为空')
    if any(not name.strip() or len(name.strip()) > 255 for name in body.display_names.values()):
        raise HTTPException(422, '展示名称不能为空，且不能超过 255 个字符')
    token = claim(dataset_id)
    try:
        if body.preview_id:
            with SessionLocal() as session:
                source = session.get(DynamicSource, dataset_id)
                if not source:
                    raise HTTPException(404, '动态数据源不存在')
                config = stored_config(body, source.config)
            execution_config = resolve_connection(config)
            preview, duration = read_source_preview(body.preview_id, execution_config)
            preview = configured_preview(preview, execution_config)
            if not body.display_names.keys() <= {field.name for field in preview.fields}:
                raise HTTPException(422, 'Unknown field')
            schedule = body.schedule.model_dump()
            day = cache_day(schedule)
            root = dataset_dir(dataset_id) / 'cache'
            def on_publish(session, item, snapshot, files):
                snapshot.schema_json = [{**field, 'display_name': body.display_names.get(field['name'], field['display_name']).strip()} for field in snapshot.schema_json]
                source = session.get(DynamicSource, dataset_id)
                source.config, source.schedule = config, schedule
                source.duration_seconds, source.last_run_at = duration, utc_now()
                source.next_run_at, source.last_error = next_run(schedule), None
                source.lease_token, source.lease_until = None, None
                files.enter_context(rollback_files([root / f'{day}.parquet', root / f'{day}.json']))
                save_cache(snapshot, execution_config, schedule, duration, day)
            result = publish(body.name.strip(), preview, 'dynamic', dataset_id=dataset_id, version=body.version, formats=body.formats, on_publish=on_publish, annotation_fields=body.annotation_fields)
            discard_source_preview(body.preview_id)
            return result
        with ExitStack() as files, SessionLocal.begin() as session:
            source = session.get(DynamicSource, dataset_id)
            result = session.execute(update(Dataset).where(Dataset.id == dataset_id, Dataset.version == body.version).values(name=body.name.strip(), version=Dataset.version + 1))
            if result.rowcount != 1:
                raise HTTPException(409, '数据集已被修改，请重新打开后再试')
            files.enter_context(rollback_files([dataset_manifest_path(dataset_id, session)]))
            source.config = stored_config(body, source.config)
            source.schedule = body.schedule.model_dump()
            source.next_run_at = next_run(source.schedule)
            source.last_error = None
            write_dataset(dataset_id, session)
    finally:
        release(dataset_id, token)
    return dataset_payload(*get_pair(dataset_id))


@router.post('/datasets/{dataset_id}/refresh')
def refresh_source(dataset_id: str, force: bool = False):
    return refresh(dataset_id, force=force)


@router.get('/datasets/{dataset_id}/files')
def list_files(dataset_id: str):
    get_pair(dataset_id)
    root = dataset_dir(dataset_id)
    files = []
    if root.exists():
        for path in sorted(root.rglob('*')):
            if not path.is_file() or path.name.startswith('.'):
                continue
            relative = path.relative_to(root).as_posix()
            entry = {'name': relative, 'bytes': path.stat().st_size}
            if path.parent.name == 'cache' and path.suffix == '.parquet':
                index = path.with_suffix('.json')
                if index.is_file():
                    entry.update(json.loads(index.read_text(encoding='utf-8')))
            files.append(entry)
    return {'directory': f'datasets/{dataset_id}', 'files': files}


@router.delete('/datasets/{dataset_id}/cache/{day}', status_code=204)
def delete_cache(dataset_id: str, day: str):
    try:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, '缓存日期无效')
    token = claim(dataset_id)
    try:
        root = dataset_dir(dataset_id) / 'cache'
        (root / f'{day}.parquet').unlink(missing_ok=True)
        (root / f'{day}.json').unlink(missing_ok=True)
    finally:
        release(dataset_id, token)
