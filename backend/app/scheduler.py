import logging
from datetime import timezone
from threading import Event
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select

from .db import SessionLocal
from .dynamic import Schedule, refresh, utc_now
from .models import Dashboard, DynamicSource

logger = logging.getLogger('mybi.scheduler')


def run(stop: Event):
    while not stop.is_set():
        try:
            now = utc_now()
            with SessionLocal() as session:
                reports = list(session.scalars(select(Dashboard)))
                managed = set()
                report_ids = {}
                for report in reports:
                    if 'refreshSchedule' not in report.document:
                        continue
                    plan = Schedule.model_validate(report.document['refreshSchedule'])
                    sources = {source['id'] for source in report.document.get('datasets', [])}
                    sources.update(chart['datasetId'] for chart in report.document.get('charts', []) if chart.get('datasetId'))
                    managed.update(sources)
                    if not plan.enabled:
                        continue
                    local = now.astimezone(ZoneInfo(plan.timezone))
                    hour, minute = map(int, plan.time.split(':'))
                    due = local.replace(hour=hour, minute=minute, second=0, microsecond=0, fold=0)
                    if due > local:
                        continue
                    cutoff = due.astimezone(timezone.utc)
                    candidates = session.scalars(select(DynamicSource.dataset_id).where(
                        DynamicSource.dataset_id.in_(sources),
                        or_(DynamicSource.last_run_at.is_(None), DynamicSource.last_run_at < cutoff),
                        or_(DynamicSource.lease_until.is_(None), DynamicSource.lease_until <= now),
                    ))
                    for identity in candidates:
                        report_ids[identity] = max(report_ids.get(identity, cutoff), cutoff)
                ids = list(session.scalars(select(DynamicSource.dataset_id).where(
                    DynamicSource.next_run_at <= now,
                    or_(DynamicSource.lease_until.is_(None), DynamicSource.lease_until <= now),
                ).order_by(DynamicSource.next_run_at)))
                ids = [identity for identity in ids if identity not in managed]
            for dataset_id in [*sorted(report_ids), *ids]:
                if stop.is_set():
                    break
                try:
                    refresh(dataset_id, force=True, due_only=dataset_id not in report_ids, scheduled_after=report_ids.get(dataset_id))
                except Exception:
                    logger.warning('Scheduled refresh failed for dataset %s; see dataset execution status.', dataset_id)
        except Exception:
            logger.exception('Unable to poll scheduled datasets')
        stop.wait(15)


if __name__ == '__main__':
    import signal
    logging.basicConfig(level=logging.INFO)
    shutdown = Event()
    signal.signal(signal.SIGTERM, lambda *_: shutdown.set())
    signal.signal(signal.SIGINT, lambda *_: shutdown.set())
    run(shutdown)
