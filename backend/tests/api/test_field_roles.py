from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_first_row_types_can_be_overridden_without_losing_decimals():
    body = {'name': 'types', 'text': 'count\tvalue\tflag\tday\n1,026\t1.5\ttrue\t2026-10-28T12:30:00\n2.5\t2\tfalse\t2026-10-29T00:00:00'}
    preview = client.post('/api/imports/paste', json={**body, 'preview': True}).json()
    assert [field['type'] for field in preview['schema']] == ['integer', 'number', 'string', 'date']
    assert client.post('/api/imports/paste', json=body).status_code == 422
    response = client.post('/api/imports/paste', json={**body, 'overrides': {'count': 'number'}})
    assert response.status_code == 201, response.text
    data = response.json()
    rows = client.post(f"/api/datasets/{data['id']}/view-query", json={'fields': ['count', 'flag', 'day']}).json()['rows']
    assert rows[1] == {'count': 2.5, 'flag': 'false', 'day': '2026-10-29'}


def test_field_roles_are_checked_for_primary_and_secondary_bindings():
    data = client.post('/api/imports/paste', json={'name': 'roles', 'text': 'name\tday\tcount\nA\t2026-10-28\t2'}).json()
    path = f"/api/datasets/{data['id']}/view-query"
    base = {'fields': ['name', 'day', 'count'], 'dimension': 'name', 'measure': 'count', 'aggregation': 'sum'}
    assert client.post(path, json=base).status_code == 200
    for patch in [{'dimension': 'count'}, {'measure': 'name'}, {'second_dimension': 'count'}, {'second_measure': 'day'}, {'measures': ['name']}]:
        assert client.post(path, json={**base, **patch}).status_code == 422
    assert client.post(path, json={**base, 'dimension': 'day'}).status_code == 200


def test_integer_edit_rejects_fraction_and_removed_types():
    data = client.post('/api/imports/paste', json={'name': 'edit', 'text': 'value\n1.5'}).json()
    path = f"/api/datasets/{data['id']}"
    for kind in ['integer', 'boolean', 'datetime']:
        assert client.patch(path + '/fields', json={'version': data['version'], 'types': {'value': kind}}).status_code == 422
        assert client.get(path).json() == data

    data = client.post('/api/imports/paste', json={'name': 'whole', 'text': 'value\n1'}).json()
    path = f"/api/datasets/{data['id']}"
    for kind in ['boolean', 'datetime']:
        assert client.patch(path + '/fields', json={'version': data['version'], 'types': {'value': kind}}).status_code == 422
        assert client.get(path).json() == data
