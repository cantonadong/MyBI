import json
import os
import logging
from pathlib import Path, PureWindowsPath
import shutil
from contextlib import contextmanager, nullcontext
from uuid import UUID, uuid4

from sqlalchemy import select, update

from .db import SessionLocal
from .models import Dataset, DatasetSnapshot, Dashboard, PublishedDashboard, DynamicSource
from .settings import settings


def dataset_dir(dataset_id: str) -> Path:
    return settings.dataset_root / str(UUID(dataset_id))


def atomic_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    candidate = path.with_name(f'.{path.name}.{uuid4()}.tmp')
    try:
        with candidate.open('w', encoding='utf-8') as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2, default=str, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        candidate.replace(path)
    finally:
        candidate.unlink(missing_ok=True)


def atomic_copy(source: Path, destination: Path):
    destination.parent.mkdir(parents=True, exist_ok=True)
    candidate = destination.with_name(f'.{destination.name}.{uuid4()}.tmp')
    try:
        shutil.copyfile(source, candidate)
        candidate.replace(destination)
    finally:
        candidate.unlink(missing_ok=True)


@contextmanager
def rollback_files(paths):
    backups = {}
    completed = False
    try:
        for path in paths:
            if path.is_file():
                backup = path.with_name(f'.{path.name}.{uuid4()}.backup')
                try:
                    os.link(path, backup)
                except OSError:
                    shutil.copyfile(path, backup)
                backups[path] = backup
            else:
                backups[path] = None
        yield
        completed = True
    except Exception:
        for path, backup in backups.items():
            if backup:
                backup.replace(path)
            else:
                path.unlink(missing_ok=True)
        raise
    finally:
        if completed:
            for backup in backups.values():
                if backup:
                    try:
                        backup.unlink(missing_ok=True)
                    except OSError:
                        logging.getLogger('mybi.storage').warning('Unable to remove backup file %s', backup)


def write_dataset(dataset_id: str, session=None):
    provided = session is not None
    with (nullcontext(session) if provided else SessionLocal.begin()) as session:
        if not provided:
            session.execute(update(Dataset).where(Dataset.id == dataset_id).values(version=Dataset.version))
        session.flush()
        item = session.get(Dataset, dataset_id)
        if not item:
            return
        snapshots = list(session.scalars(select(DatasetSnapshot).where(DatasetSnapshot.dataset_id == dataset_id)))
        source = session.get(DynamicSource, dataset_id)
        config = {key: value for key, value in source.config.items() if key != 'password'} if source else None
        atomic_json(dataset_dir(dataset_id) / 'dataset.json', {
            'id': item.id, 'name': item.name, 'version': item.version,
            'current_snapshot_id': item.current_snapshot_id, 'source': config,
            'schedule': source.schedule if source else None,
            'snapshots': [{'id': snapshot.id, 'schema': snapshot.schema_json,
                           'row_count': snapshot.row_count, 'created_at': snapshot.created_at,
                           'file': f'snapshots/{snapshot.id}.parquet'} for snapshot in snapshots],
        })


def write_report(report_id: str, session=None):
    provided = session is not None
    with (nullcontext(session) if provided else SessionLocal.begin()) as session:
        if not provided:
            session.execute(update(Dashboard).where(Dashboard.id == report_id).values(version=Dashboard.version))
        session.flush()
        item = session.get(Dashboard, report_id)
        published = session.get(PublishedDashboard, report_id)
        path = settings.report_root / f'{UUID(report_id)}.json'
        if item:
            atomic_json(path, {'id': item.id, 'name': item.name, 'version': item.version,
                               'document': item.document,
                               'published': {'name': published.name, 'document': published.document, 'theme': published.theme} if published else None})
        else:
            path.unlink(missing_ok=True)


def materialize_existing():
    settings.dataset_root.mkdir(parents=True, exist_ok=True)
    settings.report_root.mkdir(parents=True, exist_ok=True)
    with SessionLocal.begin() as session:
        for snapshot in session.scalars(select(DatasetSnapshot)):
            original = Path(snapshot.storage_uri)
            if not original.is_file():
                original = settings.snapshot_root / PureWindowsPath(snapshot.storage_uri).name
            target = dataset_dir(snapshot.dataset_id) / 'snapshots' / f'{snapshot.id}.parquet'
            if original.is_file() and original.resolve() != target.resolve():
                if not target.is_file():
                    atomic_copy(original, target)
                snapshot.storage_uri = str(target.resolve())
        dataset_ids = list(session.scalars(select(Dataset.id)))
        report_ids = list(session.scalars(select(Dashboard.id)))
    for dataset_id in dataset_ids:
        write_dataset(dataset_id)
    for report_id in report_ids:
        write_report(report_id)
