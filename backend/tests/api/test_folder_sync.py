from dataclasses import replace
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import folder_sync, storage
from app.db import Base
from app.models import Dataset, Dashboard, ResourceIdentity


def test_copied_folders_use_fingerprints_and_preserve_local_data(tmp_path, monkeypatch):
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    settings = replace(storage.settings, dataset_root=tmp_path / 'datasets', report_root=tmp_path / 'reports')
    monkeypatch.setattr(folder_sync, 'settings', settings)
    monkeypatch.setattr(folder_sync, 'SessionLocal', sessions)
    monkeypatch.setattr(storage, 'settings', settings)
    monkeypatch.setattr(storage, 'SessionLocal', sessions)
    dataset_id, snapshot_id, report_id = (str(uuid4()) for _ in range(3))
    root = settings.dataset_root / dataset_id
    snapshot = root / 'snapshots' / f'{snapshot_id}.parquet'
    snapshot.parent.mkdir(parents=True)
    pq.write_table(pa.table({'version': ['1.0'], 'amount': [10]}), snapshot)
    manifest = {
        'id': dataset_id, 'local_id': 1, 'fingerprint': '1700000000000000000-device-a', 'name': 'Copied dataset', 'version': 1,
        'current_snapshot_id': snapshot_id,
        'snapshots': [{'id': snapshot_id, 'schema': [{'name': 'version', 'type': 'string'}, {'name': 'amount', 'type': 'integer'}],
                       'row_count': 1, 'created_at': '2026-11-10T00:00:00Z', 'file': f'snapshots/{snapshot_id}.parquet'}],
    }
    storage.atomic_json(root / 'dataset.json', manifest)
    report = {'id': report_id, 'local_id': 1, 'fingerprint': '1700000000000000001-device-b', 'name': 'Copied report',
              'document': {'charts': [{'id': 'chart', 'datasetId': dataset_id}], 'datasets': []},
              'dataset_fingerprints': {dataset_id: manifest['fingerprint']}}
    storage.atomic_json(settings.report_root / f'{report_id}.json', report)
    try:
        folder_sync.synchronize_folders()
        manifest_path = root / f"{manifest['fingerprint']}.json"
        assert manifest_path.is_file()
        assert (settings.report_root / f"{report['fingerprint']}.json").is_file()
        with sessions() as session:
            assert session.get(Dataset, dataset_id).current_snapshot_id == snapshot_id
            assert session.get(Dashboard, report_id).document['charts'][0]['datasetId'] == dataset_id
            identities = list(session.scalars(select(ResourceIdentity)))
            assert len({item.local_id for item in identities}) == 2
            original_ids = {item.fingerprint: item.local_id for item in identities}
            version = session.get(Dataset, dataset_id).version
        folder_sync.synchronize_folders()
        with sessions() as session:
            assert session.get(Dataset, dataset_id).version == version
        manifest['name'] = 'Updated on another computer'
        storage.atomic_json(manifest_path, manifest)
        folder_sync.synchronize_folders()
        with sessions() as session:
            assert session.get(Dataset, dataset_id).name == manifest['name']
            assert {item.fingerprint: item.local_id for item in session.scalars(select(ResourceIdentity))} == original_ids
        snapshot.rename(snapshot.with_suffix('.copying'))
        manifest['name'] = 'Incomplete copy'
        storage.atomic_json(manifest_path, manifest)
        folder_sync.synchronize_folders()
        with sessions() as session:
            assert session.get(Dataset, dataset_id).name == 'Updated on another computer'
        snapshot.with_suffix('.copying').rename(snapshot)
        folder_sync.synchronize_folders()
        with sessions() as session:
            assert session.get(Dataset, dataset_id).name == 'Incomplete copy'
    finally:
        engine.dispose()
