from datetime import datetime, timezone

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app import dynamic
from app.api import sources
from app.imports.delimited import parse_delimited
from app.storage import dataset_dir


def test_staged_query_does_not_create_dataset_and_saves_full_result_without_requery(monkeypatch):
    calls = []
    preview = parse_delimited('region\tamount\n' + '\n'.join(f'R{i}\t{i}.125' for i in range(7)))
    def execute(config):
        calls.append(config)
        return preview, 1.25
    monkeypatch.setattr(sources, 'execute', execute)
    client = TestClient(app)
    connection = client.post('/api/connections', json={'name': 'staged import connection', 'host': 'database.invalid', 'database': 'sales', 'user': 'readonly', 'password': 'test-secret'}).json()
    source = {'connection_id': connection['id'], 'sql': 'SELECT region, amount FROM sales'}
    before = {item['id'] for item in client.get('/api/datasets').json()}
    staged = client.post('/api/sources/preview', json=source)
    assert staged.status_code == 200
    assert staged.json()['row_count'] == 7
    assert len(staged.json()['rows']) == 5
    assert {item['id'] for item in client.get('/api/datasets').json()} == before
    saved = client.post('/api/sources', json={**source, 'name': 'Staged import', 'preview_id': staged.json()['preview_id'], 'formats': {'amount': {'kind': 'decimal', 'format': 'number', 'decimals': 4}}})
    assert saved.status_code == 201
    assert saved.json()['row_count'] == 7
    assert saved.json()['field_formats']['amount']['decimals'] == 4
    assert len(calls) == 1
    abandoned = client.post('/api/sources/preview', json=source).json()
    assert client.delete('/api/sources/previews/' + abandoned['preview_id']).status_code == 204
    assert len(client.get('/api/datasets').json()) == len(before) + 1


def test_cache_write_failure_keeps_previous_dataset_and_files(monkeypatch):
    original = parse_delimited('region\tamount\nNorth\t12.5')
    monkeypatch.setattr(sources, 'execute', lambda _: (original, 1.25))
    client = TestClient(app)
    created = client.post('/api/sources', json={
        'name': 'dynamic sales', 'host': 'database.invalid', 'database': 'sales',
        'user': 'readonly', 'password': 'never-return-this', 'sql': 'SELECT region, amount FROM sales',
    })
    assert created.status_code == 201
    dataset = created.json()
    root = dataset_dir(dataset['id'])
    cache = next((root / 'cache').glob('*.parquet'))
    previous_cache = cache.read_bytes()
    previous_index = cache.with_suffix('.json').read_bytes()
    previous_manifest = (root / 'dataset.json').read_bytes()
    assert 'never-return-this' not in previous_manifest.decode()
    assert 'password' not in client.get(f"/api/datasets/{dataset['id']}/dynamic").json()
    monkeypatch.setattr(dynamic, 'execute_query', lambda _: (parse_delimited('region\tamount\nSouth\t99.5'), 2.5))

    def fail_index(*_):
        raise OSError('storage full')

    monkeypatch.setattr(dynamic, 'atomic_json', fail_index)
    with pytest.raises(OSError):
        dynamic.refresh(dataset['id'], force=True)
    reopened = client.get(f"/api/datasets/{dataset['id']}").json()
    assert reopened['snapshot_id'] == dataset['snapshot_id']
    assert cache.read_bytes() == previous_cache
    assert cache.with_suffix('.json').read_bytes() == previous_index
    assert (root / 'dataset.json').read_bytes() == previous_manifest
    assert len(list((root / 'snapshots').glob('*.parquet'))) == 1


def test_schedule_uses_explicit_utc_and_runs_daily_in_its_timezone():
    next_run = dynamic.next_run({'enabled': True, 'time': '06:00', 'timezone': 'Pacific/Auckland'},
                                datetime(2026, 11, 4, 18, 0, tzinfo=timezone.utc))
    assert next_run == datetime(2026, 11, 5, 17, 0, tzinfo=timezone.utc)
    assert dynamic.utc_iso(datetime(2026, 11, 5, 17, 0)) == '2026-11-05T17:00:00+00:00'
    assert dynamic.next_run({'enabled': False}) is None
