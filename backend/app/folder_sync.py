import hashlib
import logging
from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from uuid import UUID, uuid4

import pyarrow.parquet as pq
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from .db import SessionLocal
from .models import Dataset, DatasetSnapshot, Dashboard, PublishedDashboard, DynamicSource, ResourceIdentity
from .settings import settings
from .storage import atomic_copy, dataset_dir, dataset_manifest_path, resource_identity, migrate_manifest

_lock = RLock()
logger = logging.getLogger('mybi.sync')


class ResourceFile(BaseModel):
    id: UUID
    fingerprint: str | None = Field(default=None, min_length=1, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    owner: str | None = Field(default=None, max_length=255)
    updated_at: datetime | None = None
    name: str = Field(min_length=1, max_length=255)
    version: int = Field(default=1, ge=1)


class SnapshotFile(BaseModel):
    id: UUID
    fields: list[dict] = Field(alias='schema', min_length=1)
    row_count: int = Field(ge=0)
    created_at: datetime
    file: str


class DatasetFile(ResourceFile):
    current_snapshot_id: UUID
    snapshots: list[SnapshotFile] = Field(min_length=1)
    source: dict | None = None
    schedule: dict | None = None


class ReportFile(ResourceFile):
    document: dict
    published: dict | None = None
    dataset_fingerprints: dict[str, str] = Field(default_factory=dict)


def identity_for_file(kind, data, session):
    fingerprint = data.fingerprint or str(data.id)
    identity = session.scalar(select(ResourceIdentity).where(ResourceIdentity.fingerprint == fingerprint))
    if identity:
        if identity.kind != kind:
            raise ValueError('Fingerprint belongs to a different resource type')
        return identity
    resource_id = str(data.id)
    previous = session.scalar(select(ResourceIdentity).where(ResourceIdentity.kind == kind, ResourceIdentity.resource_id == resource_id))
    if previous:
        if previous.fingerprint == resource_id:
            previous.fingerprint = fingerprint
            return previous
        resource_id = str(uuid4())
    return resource_identity(kind, resource_id, session, fingerprint)


def import_dataset(data, path, session):
    from .api.datasets import DisplayUpdate
    from .dynamic import Schedule, SourceConfig

    if str(data.id) != path.parent.name:
        raise ValueError('Dataset folder does not match its ID')
    if path.name not in {'dataset.json', f'{data.fingerprint or data.id}.json'}:
        raise ValueError('Dataset manifest filename does not match its fingerprint')
    if data.current_snapshot_id not in {snapshot.id for snapshot in data.snapshots}:
        raise ValueError('Current snapshot is missing from the manifest')
    for snapshot in data.snapshots:
        if snapshot.file != f'snapshots/{snapshot.id}.parquet':
            raise ValueError('Invalid snapshot path')
        source_path = path.parent / snapshot.file
        if source_path.is_symlink() or not source_path.resolve().is_relative_to(path.parent.resolve()):
            raise ValueError('Snapshot must be inside the dataset folder')
        metadata = pq.read_metadata(source_path)
        names = set()
        for field in snapshot.fields:
            if not isinstance(field.get('name'), str) or not field['name'] or field['name'] in names or field.get('type') not in {'string', 'date', 'number', 'integer', 'boolean'}:
                raise ValueError('Invalid snapshot field')
            names.add(field['name'])
            if field.get('display'):
                DisplayUpdate.model_validate(field['display'])
        if metadata.num_rows != snapshot.row_count or not names.issubset(metadata.schema.to_arrow_schema().names):
            raise ValueError('Snapshot does not match its manifest')
    source_config = SourceConfig.model_validate(data.source) if data.source is not None else None
    schedule = Schedule.model_validate(data.schedule or {}).model_dump()
    identity = identity_for_file('dataset', data, session)
    if data.owner:
        identity.owner = data.owner
    if data.updated_at:
        identity.updated_at = data.updated_at.replace(tzinfo=data.updated_at.tzinfo or timezone.utc).astimezone(timezone.utc).replace(tzinfo=None)
    item = session.get(Dataset, identity.resource_id)
    created = item is None
    changed = created
    if item is None:
        item = Dataset(id=identity.resource_id, name=data.name, version=data.version)
        session.add(item)
        session.flush()
    for snapshot in data.snapshots:
        target = dataset_dir(item.id) / snapshot.file
        original = path.parent / snapshot.file
        if target.resolve() != original.resolve() and not target.exists():
            atomic_copy(original, target)
        existing = session.get(DatasetSnapshot, str(snapshot.id))
        if existing and existing.dataset_id != item.id:
            raise ValueError('Snapshot belongs to another dataset')
        if existing is None:
            existing = DatasetSnapshot(id=str(snapshot.id), dataset_id=item.id)
            session.add(existing)
            changed = True
        values = dict(schema_json=snapshot.fields, row_count=snapshot.row_count, storage_uri=str(target.resolve()), status='SUCCEEDED', created_at=snapshot.created_at.replace(tzinfo=None))
        for key, value in values.items():
            if getattr(existing, key) != value:
                setattr(existing, key, value)
                changed = True
    source = session.get(DynamicSource, item.id)
    if source_config is not None:
        from .dynamic import cipher
        config = {key: value for key, value in data.source.items() if key not in {'password', 'sync_requires_connection'}}
        same_connection = source is not None and all(source.config.get(key) == config.get(key) for key in ('connection_id', 'host', 'port', 'database', 'user', 'redshift'))
        if not config.get('connection_id'):
            config['password'] = source.config.get('password') if same_connection else cipher().encrypt(b'').decode()
        if not same_connection:
            config['sync_requires_connection'] = True
        elif source.config.get('sync_requires_connection'):
            config['sync_requires_connection'] = True
        if source is None:
            source = DynamicSource(dataset_id=item.id, config=config, schedule=schedule, last_error='同步的数据源需要在本机配置数据库连接')
            session.add(source)
            changed = True
        elif source.config != config or source.schedule != schedule:
            if source.lease_token:
                raise ValueError('Dataset is currently refreshing; retry after it finishes')
            source.config, source.schedule, source.next_run_at = config, schedule, None
            changed = True
    elif source is not None:
        if source.lease_token:
            raise ValueError('Dataset is currently refreshing; retry after it finishes')
        session.delete(source)
        changed = True
    if item.name != data.name or item.current_snapshot_id != str(data.current_snapshot_id):
        changed = True
    if changed:
        if source is not None and source.lease_token:
            raise ValueError('Dataset is currently refreshing; retry after it finishes')
        item.name, item.current_snapshot_id = data.name, str(data.current_snapshot_id)
        item.version = max(item.version + (0 if created else 1), data.version)
        if not created and data.updated_at is None:
            identity.updated_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    return item.id


def import_report(data, path, session, datasets):
    from .api.dashboards import SaveDashboard

    if path.stem not in {str(data.id), data.fingerprint or str(data.id)}:
        raise ValueError('Report filename does not match its ID')
    mapping = dict(datasets)
    for original, fingerprint in data.dataset_fingerprints.items():
        identity = session.scalar(select(ResourceIdentity).where(ResourceIdentity.kind == 'dataset', ResourceIdentity.fingerprint == fingerprint))
        if identity is None:
            raise ValueError('A referenced dataset has not been copied yet')
        mapping[original] = identity.resource_id

    def document_for(document):
        document = SaveDashboard(name=data.name, document=deepcopy(document)).document
        for chart in document.get('charts', []):
            original = chart.get('datasetId')
            if original:
                chart['datasetId'] = mapping.get(original, original)
                if session.get(Dataset, chart['datasetId']) is None:
                    raise ValueError('A referenced dataset has not been copied yet')
            for condition in chart.get('filters', []):
                if condition.get('datasetId'):
                    condition['datasetId'] = mapping.get(condition['datasetId'], condition['datasetId'])
        for dataset in document.get('datasets', []):
            dataset['id'] = mapping.get(dataset['id'], dataset['id'])
            if session.get(Dataset, dataset['id']) is None:
                raise ValueError('A referenced dataset has not been copied yet')
            if dataset.get('snapshot_id'):
                snapshot = session.get(DatasetSnapshot, dataset['snapshot_id'])
                if snapshot is None or snapshot.dataset_id != dataset['id']:
                    raise ValueError('A referenced snapshot has not been copied yet')
            dataset['storage_path'] = f"datasets/{dataset['id']}/{dataset_manifest_path(dataset['id'], session).name}"
        for condition in document.get('filters', []):
            if condition.get('datasetId'):
                condition['datasetId'] = mapping.get(condition['datasetId'], condition['datasetId'])
        return document

    document = document_for(data.document)
    published = data.published
    if published is not None:
        if not isinstance(published.get('name'), str) or not isinstance(published.get('theme'), dict):
            raise ValueError('Invalid published report')
        published = {**published, 'document': document_for(published['document'])}
    identity = identity_for_file('report', data, session)
    if data.owner:
        document['_mybi'] = {**document.get('_mybi', {}), 'owner': data.owner}
    if data.updated_at:
        document['_mybi'] = {**document.get('_mybi', {}), 'updated_at': data.updated_at.isoformat()}
    item = session.get(Dashboard, identity.resource_id)
    if item is None:
        item = Dashboard(id=identity.resource_id, name=data.name, document=document, version=data.version)
        session.add(item)
    elif item.name != data.name or item.document != document:
        item.name, item.document = data.name, document
        item.version = max(item.version + 1, data.version)
    current = session.get(PublishedDashboard, item.id)
    if published is None:
        if current:
            session.delete(current)
    elif current is None:
        session.add(PublishedDashboard(id=item.id, name=published['name'], document=published['document'], theme=published['theme']))
    else:
        current.name, current.document, current.theme = published['name'], published['document'], published['theme']


def synchronize_folders():
    migrations = set()
    with _lock, SessionLocal.begin() as session:
        # Lock before reading files so an application save cannot be imported before its transaction commits.
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        for kind, model in (('dataset', Dataset), ('report', Dashboard)):
            for item in session.scalars(select(model)):
                resource_identity(kind, item.id, session, item.id)
        datasets = {}
        for kind, paths, model in (
            ('dataset', settings.dataset_root.glob('*/*.json'), DatasetFile),
            ('report', settings.report_root.glob('*.json'), ReportFile),
        ):
            root = settings.dataset_root if kind == 'dataset' else settings.report_root
            for path in sorted(paths):
                try:
                    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.stat().st_size > settings.max_upload_bytes:
                        raise ValueError('Invalid resource file path or size')
                    content = path.read_bytes()
                    data = model.model_validate_json(content.decode('utf-8-sig'))
                    canonical = path.with_name(f'{data.fingerprint or data.id}.json')
                    if path != canonical and canonical.is_file():
                        continue
                    digest = hashlib.sha256(content).hexdigest()
                    key = kind + '/' + path.relative_to(root).as_posix()
                    with session.begin_nested():
                        identity = session.scalar(select(ResourceIdentity).where(ResourceIdentity.fingerprint == (data.fingerprint or str(data.id))))
                        resource_model = Dataset if kind == 'dataset' else Dashboard
                        if identity and identity.kind == kind and identity.file_state.get(key) == digest and session.get(resource_model, identity.resource_id) is not None:
                            if kind == 'dataset':
                                datasets[str(data.id)] = identity.resource_id
                            migrations.add((kind, identity.resource_id))
                            continue
                        if kind == 'dataset':
                            local_id = import_dataset(data, path, session)
                        else:
                            import_report(data, path, session, datasets)
                        identity = session.scalar(select(ResourceIdentity).where(ResourceIdentity.fingerprint == (data.fingerprint or str(data.id))))
                        identity.file_state = {**identity.file_state, key: digest}
                        migrations.add((kind, identity.resource_id))
                    if kind == 'dataset':
                        datasets[str(data.id)] = local_id
                except (OSError, ValueError, TypeError, KeyError, AttributeError, SQLAlchemyError):
                    logger.warning('Unable to synchronize %s; local data was kept. Copy the complete resource and refresh again.', path, exc_info=True)
    for kind, resource_id in migrations:
        try:
            migrate_manifest(kind, resource_id)
        except OSError:
            logger.warning('Unable to rename manifest for %s %s; it will be retried on refresh.', kind, resource_id)
