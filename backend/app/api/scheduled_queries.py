import json
from contextlib import ExitStack
from datetime import datetime, timedelta
from threading import Thread
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update

from ..db import SessionLocal
from ..dynamic import SourceConfig, execute, next_run, stored_config, utc_iso, utc_now
from ..models import Dashboard, DynamicSource, ScheduledQuery
from ..settings import settings
from ..storage import report_path, resource_identity, rollback_files, write_report

router = APIRouter(prefix='/api/scheduled-queries')


class ScheduledQueryRequest(SourceConfig):
    name: str = Field(min_length=1, max_length=255)


def payload(item: ScheduledQuery, session):
    # local_id: the short auto-increment ID shown to users (shared sequence with datasets and reports).
    return {'id': item.id, 'local_id': resource_identity('scheduled', item.id, session).number, 'name': item.name, 'schedule': item.schedule,
            **{key: item.config.get(key) for key in ('connection_id', 'database', 'mode', 'sql', 'schema_name', 'object_name')},
            'duration_seconds': item.duration_seconds, 'row_count': item.row_count, 'last_error': item.last_error,
            'last_run_at': utc_iso(item.last_run_at), 'next_run_at': utc_iso(item.next_run_at),
            'running': item.lease_token is not None, 'started_at': utc_iso(active_runs.get('task:' + item.id))}


def validated(body: ScheduledQueryRequest):
    # Same rules as dynamic datasets: saved connection only, query executed through the shared core.
    if not body.connection_id:
        raise HTTPException(422, '请选择已保存的连接')
    if not body.name.strip():
        raise HTTPException(422, '名称不能为空')
    return stored_config(body), body.schedule.model_dump()


@router.get('')
def list_queries():
    with SessionLocal.begin() as session:
        return [payload(item, session) for item in session.scalars(select(ScheduledQuery).order_by(ScheduledQuery.name))]


@router.post('', status_code=201)
def create_query(body: ScheduledQueryRequest):
    config, schedule = validated(body)
    with SessionLocal.begin() as session:
        item = ScheduledQuery(name=body.name.strip(), config=config, schedule=schedule, next_run_at=next_run(schedule))
        session.add(item)
        session.flush()
        return payload(item, session)


@router.put('/{query_id}')
def save_query(query_id: str, body: ScheduledQueryRequest):
    config, schedule = validated(body)
    with SessionLocal.begin() as session:
        item = session.get(ScheduledQuery, query_id)
        if not item:
            raise HTTPException(404, '定时任务不存在')
        item.name, item.config, item.schedule, item.next_run_at = body.name.strip(), config, schedule, next_run(schedule)
        return payload(item, session)


@router.delete('/{query_id}', status_code=204)
def delete_query(query_id: str):
    token = claim(query_id)
    with SessionLocal.begin() as session:
        session.execute(delete(ScheduledQuery).where(ScheduledQuery.id == query_id, ScheduledQuery.lease_token == token))


# Runs started from the page execute in the background: the request returns at once and leaving the page
# does not affect the run. Start times (for the live elapsed time) are kept per process.
active_runs: dict[str, datetime] = {}


@router.post('/{query_id}/run')
def run_now(query_id: str):
    token = claim(query_id)
    active_runs['task:' + query_id] = utc_now()
    Thread(target=execute_claimed, args=(query_id, token), daemon=True, name=f'scheduled-task-{query_id}').start()
    with SessionLocal.begin() as session:
        return payload(session.get(ScheduledQuery, query_id), session)


def claim(query_id: str, due_only=False):
    now = utc_now()
    token = str(uuid4())
    conditions = [ScheduledQuery.id == query_id, or_(ScheduledQuery.lease_until.is_(None), ScheduledQuery.lease_until <= now)]
    if due_only:
        conditions.append(ScheduledQuery.next_run_at <= now)
    with SessionLocal.begin() as session:
        if not session.get(ScheduledQuery, query_id):
            raise HTTPException(404, '定时任务不存在')
        result = session.execute(update(ScheduledQuery).where(*conditions).values(lease_token=token, lease_until=now + timedelta(seconds=settings.dynamic_timeout_seconds + 120)))
        if result.rowcount != 1:
            raise HTTPException(409, '定时任务正在执行，请稍后再试')
    return token


def run_query(query_id: str, due_only=False):
    """Execute and record the outcome; failures are stored on the task, not raised."""
    token = claim(query_id, due_only)
    active_runs['task:' + query_id] = utc_now()
    execute_claimed(query_id, token)


def execute_claimed(query_id: str, token: str):
    started = active_runs.get('task:' + query_id) or utc_now()
    try:
        with SessionLocal() as session:
            item = session.get(ScheduledQuery, query_id)
            config, schedule = item.config, item.schedule
        values = {'row_count': None, 'last_error': None, 'duration_seconds': None}
        _execute_task(config, values)
        # last_run_at is when the latest run finished (success or failure).
        finished = utc_now()
        values['last_run_at'] = finished
        if values['duration_seconds'] is None:
            values['duration_seconds'] = (finished - started).total_seconds()
        with SessionLocal.begin() as session:
            session.execute(update(ScheduledQuery).where(ScheduledQuery.id == query_id, ScheduledQuery.lease_token == token).values(lease_token=None, lease_until=None, next_run_at=next_run(schedule), **values))
    finally:
        active_runs.pop('task:' + query_id, None)


def _execute_task(config, values):
    try:
        preview, values['duration_seconds'] = execute(config)
        values['row_count'] = len(preview.rows)
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else '定时任务执行失败，请检查服务日志'
        if isinstance(detail, dict):
            values['duration_seconds'] = detail.get('duration_seconds')
        values['last_error'] = (json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail))[:2000]


def due_ids(now):
    with SessionLocal() as session:
        return list(session.scalars(select(ScheduledQuery.id).where(
            ScheduledQuery.next_run_at <= now,
            or_(ScheduledQuery.lease_until.is_(None), ScheduledQuery.lease_until <= now),
        ).order_by(ScheduledQuery.next_run_at)))

# Report refresh schedules ("每日定时查询" in a report) are listed on the scheduled-tasks page with the owning report.
def report_dataset_ids(document):
    ids = [source['id'] for source in document.get('datasets', []) if source.get('id')]
    ids += [chart['datasetId'] for chart in document.get('charts', []) if chart.get('datasetId')]
    return list(dict.fromkeys(ids))


def report_row(report: Dashboard, session):
    plan = report.document.get('refreshSchedule')
    ids = report_dataset_ids(report.document)
    sources = list(session.scalars(select(DynamicSource).where(DynamicSource.dataset_id.in_(ids)))) if ids else []
    if not plan or not sources:
        return None
    runs = [source for source in sources if source.last_run_at]
    errors = [source.last_error for source in sources if source.last_error]
    # A dataset's last_run_at is when its refresh started; the report's last run finished when the latest refresh did.
    finished = max((source.last_run_at + timedelta(seconds=source.duration_seconds or 0) for source in runs), default=None)
    started = active_runs.get('report:' + report.id)
    return {'id': report.id, 'local_id': resource_identity('report', report.id, session).number, 'name': report.name, 'schedule': plan,
            'dataset_count': len(sources), 'last_run_at': utc_iso(finished),
            'duration_seconds': sum(source.duration_seconds or 0 for source in runs) if runs else None,
            'last_error': errors[0] if errors else None, 'running': started is not None or any(source.lease_token is not None for source in sources),
            'started_at': utc_iso(started)}


@router.get('/reports')
def list_report_schedules():
    with SessionLocal.begin() as session:
        return [row for row in (report_row(report, session) for report in session.scalars(select(Dashboard).order_by(Dashboard.name))) if row]


@router.post('/reports/{report_id}/run')
def run_report_schedule(report_id: str):
    from ..dynamic import refresh
    with SessionLocal() as session:
        report = session.get(Dashboard, report_id)
        if not report:
            raise HTTPException(404, '报表不存在')
        ids = [source.dataset_id for source in session.scalars(select(DynamicSource).where(DynamicSource.dataset_id.in_(report_dataset_ids(report.document))))]
    if 'report:' + report_id in active_runs:
        raise HTTPException(409, '定时任务正在执行，请稍后再试')
    active_runs['report:' + report_id] = utc_now()

    def work():
        try:
            for dataset_id in ids:
                try:
                    refresh(dataset_id, force=True)
                except Exception:
                    pass  # the failure is recorded on the dataset and shown in the row status
        finally:
            active_runs.pop('report:' + report_id, None)
    Thread(target=work, daemon=True, name=f'report-refresh-{report_id}').start()
    with SessionLocal.begin() as session:
        return report_row(session.get(Dashboard, report_id), session)


class ReportScheduleToggle(BaseModel):
    enabled: bool


@router.put('/reports/{report_id}/enabled')
def toggle_report_schedule(report_id: str, body: ReportScheduleToggle):
    with ExitStack() as files, SessionLocal.begin() as session:
        report = session.get(Dashboard, report_id)
        if not report or not report.document.get('refreshSchedule'):
            raise HTTPException(404, '报表不存在')
        files.enter_context(rollback_files([report_path(report_id, session), settings.report_root / f'{report_id}.json']))
        report.document = {**report.document, 'refreshSchedule': {**report.document['refreshSchedule'], 'enabled': body.enabled}}
        report.version += 1
        session.flush()
        write_report(report_id, session)
        return report_row(report, session)
