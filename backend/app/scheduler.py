import logging
from threading import Event

from sqlalchemy import or_, select

from .db import SessionLocal
from .dynamic import refresh, utc_now
from .models import DynamicSource

logger = logging.getLogger('mybi.scheduler')


def run(stop: Event):
    while not stop.is_set():
        try:
            now = utc_now()
            with SessionLocal() as session:
                ids = list(session.scalars(select(DynamicSource.dataset_id).where(
                    DynamicSource.next_run_at <= now,
                    or_(DynamicSource.lease_until.is_(None), DynamicSource.lease_until <= now),
                ).order_by(DynamicSource.next_run_at)))
            for dataset_id in ids:
                if stop.is_set():
                    break
                try:
                    refresh(dataset_id, force=True, due_only=True)
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
