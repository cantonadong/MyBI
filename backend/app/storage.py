import json
import os
import logging
import time
import hashlib
from datetime import datetime, timezone
from getpass import getuser
from pathlib import Path, PureWindowsPath
import shutil
from contextlib import contextmanager, nullcontext
from uuid import UUID, uuid4, getnode

from sqlalchemy import select, update

from .db import SessionLocal
from .models import Dataset, DatasetSnapshot, Dashboard, PublishedDashboard, DynamicSource, ResourceIdentity, UserProfile
from .settings import settings


def dataset_dir(dataset_id: str) -> Path:
    return settings.dataset_root / str(UUID(dataset_id))


def current_owner(session):
    profile = session.get(UserProfile, 1)
    return profile.display_name if profile else getuser()


def resource_identity(kind, resource_id, session, fingerprint=None):
    item = session.scalar(select(ResourceIdentity).where(ResourceIdentity.kind == kind, ResourceIdentity.resource_id == resource_id))
    if item is None:
        item = ResourceIdentity(kind=kind, resource_id=resource_id, fingerprint=fingerprint or f'{time.time_ns()}-{getnode():012x}', owner=current_owner(session) if fingerprint is None else None, updated_at=datetime.now(timezone.utc) if fingerprint is None else None)
        session.add(item)
        session.flush()
    return item


def resource_metadata(kind, resource_id, session=None):
    with (nullcontext(session) if session is not None else SessionLocal.begin()) as current:
        item = resource_identity(kind, resource_id, current)
        return {'local_id': item.local_id, 'fingerprint': item.fingerprint, 'owner': item.owner, 'updated_at': item.updated_at.replace(tzinfo=timezone.utc).isoformat() if item.updated_at else None}


def dataset_manifest_path(dataset_id, session=None):
    return dataset_dir(dataset_id) / (resource_metadata('dataset', dataset_id, session)['fingerprint'] + '.json')


def report_path(report_id, session=None):
    return settings.report_root / (resource_metadata('report', report_id, session)['fingerprint'] + '.json')


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


def write_dataset(dataset_id: str, session=None, touch=True):
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
        identity = resource_identity('dataset', item.id, session)
        if touch:
            identity.updated_at = datetime.now(timezone.utc)
            identity.owner = identity.owner or current_owner(session)
        elif identity.updated_at is None and snapshots:
            identity.updated_at = max(snapshot.created_at for snapshot in snapshots)
        metadata = resource_metadata('dataset', item.id, session)
        atomic_json(dataset_manifest_path(dataset_id, session), {
            'id': item.id, 'fingerprint': identity.fingerprint, 'owner': metadata['owner'], 'updated_at': metadata['updated_at'], 'name': item.name, 'version': item.version,
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
        path = report_path(report_id, session)
        if item:
            dataset_ids = {chart['datasetId'] for document in (item.document, published.document if published else {}) for chart in document.get('charts', []) if chart.get('datasetId')}
            dataset_ids.update(source['id'] for document in (item.document, published.document if published else {}) for source in document.get('datasets', []) if source.get('id'))
            fingerprints = {identity: resource_identity('dataset', identity, session).fingerprint for identity in dataset_ids}
            metadata = item.document.get('_mybi', {})
            atomic_json(path, {'id': item.id, 'fingerprint': resource_identity('report', item.id, session).fingerprint, 'owner': metadata.get('owner'), 'updated_at': metadata.get('updated_at'), 'name': item.name, 'version': item.version,
                               'dataset_fingerprints': fingerprints,
                               'document': item.document,
                               'published': {'name': published.name, 'document': published.document, 'theme': published.theme} if published else None})
        else:
            path.unlink(missing_ok=True)
            (settings.report_root / f'{UUID(report_id)}.json').unlink(missing_ok=True)


def materialize_existing():
    settings.dataset_root.mkdir(parents=True, exist_ok=True)
    settings.report_root.mkdir(parents=True, exist_ok=True)
    from .folder_sync import synchronize_folders
    synchronize_folders()
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
        migrate_manifest('dataset', dataset_id)
        if not dataset_manifest_path(dataset_id).is_file() and not (dataset_dir(dataset_id) / 'dataset.json').is_file():
            write_dataset(dataset_id, touch=False)
    for report_id in report_ids:
        migrate_manifest('report', report_id)
        if not report_path(report_id).is_file() and not (settings.report_root / f'{report_id}.json').is_file():
            write_report(report_id)


def migrate_manifest(kind, resource_id):
    legacy = dataset_dir(resource_id) / 'dataset.json' if kind == 'dataset' else settings.report_root / f'{resource_id}.json'
    with SessionLocal() as session:
        target = dataset_manifest_path(resource_id, session) if kind == 'dataset' else report_path(resource_id, session)
        if target == legacy or target.exists() or not legacy.is_file():
            return
        root = settings.dataset_root if kind == 'dataset' else settings.report_root
        identity = resource_identity(kind, resource_id, session)
        key = kind + '/' + legacy.relative_to(root).as_posix()
        if identity.file_state.get(key) == hashlib.sha256(legacy.read_bytes()).hexdigest():
            legacy.rename(target)
