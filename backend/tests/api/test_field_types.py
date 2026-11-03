from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_edit_types_and_formats_atomically():
    data = client.post('/api/imports/paste', json={'name': 'types', 'text': 'a\tb\tc\n12\ttrue\t2025-01-02', 'overrides': {'a': 'string', 'b': 'string', 'c': 'string'}}).json()
    path = f"/api/datasets/{data['id']}"
    response = client.patch(path + '/fields', json={'version': data['version'], 'types': {'a': 'integer', 'c': 'date'}, 'formats': {'a': {'format': 'percent', 'decimals': 2}}})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['id'] == data['id'] and saved['version'] == data['version'] + 1
    assert saved['snapshot_id'] != data['snapshot_id']
    assert saved['field_formats']['a'] == {'kind': 'integer', 'format': 'percent', 'decimals': 2}
    rows = client.post(path + '/view-query', json={'fields': ['a', 'b', 'c']}).json()['rows']
    assert rows == [{'a': 12, 'b': 'true', 'c': '2025-01-02'}]
    assert client.patch(path + '/fields', json={'version': data['version'], 'types': {'a': 'string'}}).status_code == 409
    assert client.get(path).json() == saved

def test_invalid_value_beyond_preview_preserves_snapshot():
    data = client.post('/api/imports/paste', json={'name': 'bad', 'text': 'value\n' + '\n'.join(['12'] * 12 + ['bad']), 'overrides': {'value': 'string'}}).json()
    path = f"/api/datasets/{data['id']}"
    for types in [{'value': 'number'}, {'missing': 'number'}, {'value': 'unsupported'}]:
        response = client.patch(path + '/fields', json={'version': data['version'], 'types': types})
        assert response.status_code == 422, response.text
        assert client.get(path).json() == data


def test_batches_nulls_metadata_and_formats_only():
    data = client.post('/api/imports/paste', json={'name': 'large', 'text': 'value\tkeep\n' + '\n'.join(['12\tstable'] * 65536 + ['12.5\tstable', '\\N\tstable']), 'overrides': {'value': 'string'}}).json()
    path = f"/api/datasets/{data['id']}"
    response = client.patch(path + '/fields', json={'version': data['version'], 'types': {'value': 'number'}})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['row_count'] == 65538
    assert saved['field_formats']['value']['kind'] == 'decimal'
    assert saved['import_method'] == data['import_method']
    rows = client.post(path + '/view-query', json={'fields': ['value', 'keep'], 'offset': 65536, 'limit': 2}).json()['rows']
    assert rows == [{'value': 12.5, 'keep': 'stable'}, {'value': None, 'keep': 'stable'}]
    response = client.patch(path + '/fields', json={'version': saved['version'], 'formats': {'value': {'format': 'percent', 'decimals': 3}}})
    assert response.status_code == 200, response.text
    assert response.json()['snapshot_id'] == saved['snapshot_id']
    assert response.json()['field_formats']['value']['decimals'] == 3

def test_invalid_numeric_values_and_incompatible_conversion_are_rejected():
    for value in ['nan', 'inf', '2025-01-02']:
        data = client.post('/api/imports/paste', json={'name': 'invalid', 'text': 'value\n' + value}).json()
        path = f"/api/datasets/{data['id']}"
        response = client.patch(path + '/fields', json={'version': data['version'], 'types': {'value': 'number'}})
        assert response.status_code == 422, response.text
        assert client.get(path).json() == data
