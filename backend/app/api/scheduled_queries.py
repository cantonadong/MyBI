import json
from datetime import timedelta
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import Field
from sqlalchemy import delete, or_, select, update

from ..db import SessionLocal
from ..dynamic import SourceConfig, execute, next_run, stored_config, utc_iso, utc_now
from ..models import ScheduledQuery
from ..settings import settings

router = APIRouter(prefix='/api/scheduled-queries')


class ScheduledQueryRequest(SourceConfig):
    name: str = Field(min_length=1, max_length=255)


def payload(item: ScheduledQuery):
    return {'id': item.id, 'name': item.name, 'schedule': item.schedule,
            **{key: item.config.get(key) for key in ('connection_id', 'database', 'mode', 'sql', 'schema_name', 'object_name')},
            'duration_seconds': item.duration_seconds, 'row_count': item.row_count, 'last_error': item.last_error,
            'last_run_at': utc_iso(item.last_run_at), 'next_run_at': utc_iso(item.next_run_at),
            'running': item.lease_token is not None}


def validated(body: ScheduledQueryRequest):
    # Same rules as dynamic datasets: saved connection only, query executed through the shared core.
    if not body.connection_id:
        raise HTTPException(422, '请选择已保存的连接')
    if not body.name.strip():
        raise HTTPException(422, '名称不能为空')
    return stored_config(body), body.schedule.model_dump()


@router.get('')
def list_queries():
    with SessionLocal() as session:
        return [payload(item) for item in session.scalars(select(ScheduledQuery).order_by(ScheduledQuery.name))]


@router.post('', status_code=201)
def create_query(body: ScheduledQueryRequest):
    config, schedule = validated(body)
    with SessionLocal.begin() as session:
        item = ScheduledQuery(name=body.name.strip(), config=config, schedule=schedule, next_run_at=next_run(schedule))
        session.add(item)
        session.flush()
        return payload(item)


@router.put('/{query_id}')
def save_query(query_id: str, body: ScheduledQueryRequest):
    config, schedule = validated(body)
    with SessionLocal.begin() as session:
        item = session.get(ScheduledQuery, query_id)
        if not item:
            raise HTTPException(404, '定时查询不存在')
        item.name, item.config, item.schedule, item.next_run_at = body.name.strip(), config, schedule, next_run(schedule)
        return payload(item)


@router.delete('/{query_id}', status_code=204)
def delete_query(query_id: str):
    token = claim(query_id)
    with SessionLocal.begin() as session:
        session.execute(delete(ScheduledQuery).where(ScheduledQuery.id == query_id, ScheduledQuery.lease_token == token))


@router.post('/{query_id}/run')
def run_now(query_id: str):
    run_query(query_id)
    with SessionLocal() as session:
        return payload(session.get(ScheduledQuery, query_id))


def claim(query_id: str, due_only=False):
    now = utc_now()
    token = str(uuid4())
    conditions = [ScheduledQuery.id == query_id, or_(ScheduledQuery.lease_until.is_(None), ScheduledQuery.lease_until <= now)]
    if due_only:
        conditions.append(ScheduledQuery.next_run_at <= now)
    with SessionLocal.begin() as session:
        if not session.get(ScheduledQuery, query_id):
            raise HTTPException(404, '定时查询不存在')
        result = session.execute(update(ScheduledQuery).where(*conditions).values(lease_token=token, lease_until=now + timedelta(seconds=settings.dynamic_timeout_seconds + 120)))
        if result.rowcount != 1:
            raise HTTPException(409, '定时查询正在执行，请稍后再试')
    return token


def run_query(query_id: str, due_only=False):
    """Execute and record the outcome; failures are stored on the task, not raised."""
    token = claim(query_id, due_only)
    with SessionLocal() as session:
        item = session.get(ScheduledQuery, query_id)
        config, schedule = item.config, item.schedule
    started = utc_now()
    values = {'last_run_at': started, 'row_count': None, 'last_error': None, 'duration_seconds': None}
    try:
        preview, values['duration_seconds'] = execute(config)
        values['row_count'] = len(preview.rows)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else '定时查询执行失败，请检查服务日志'
        if isinstance(detail, dict):
            values['duration_seconds'] = detail.get('duration_seconds')
        values['last_error'] = (json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail))[:2000]
    with SessionLocal.begin() as session:
        session.execute(update(ScheduledQuery).where(ScheduledQuery.id == query_id, ScheduledQuery.lease_token == token).values(lease_token=None, lease_until=None, next_run_at=next_run(schedule), **values))


def due_ids(now):
    with SessionLocal() as session:
        return list(session.scalars(select(ScheduledQuery.id).where(
            ScheduledQuery.next_run_at <= now,
            or_(ScheduledQuery.lease_until.is_(None), ScheduledQuery.lease_until <= now),
        ).order_by(ScheduledQuery.next_run_at)))
