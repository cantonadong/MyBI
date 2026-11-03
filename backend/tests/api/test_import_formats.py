from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_first_sample_infers_numeric_subtype_precision_and_percent_values():
    body = {'name': 'formats', 'text': 'count\tprice\trate\n1,026\t12.30\t12.3%\n2\t1.2\t25%'}
    preview = client.post('/api/imports/paste', json={**body, 'preview': True}).json()
    assert preview['field_formats'] == {
        'count': {'kind': 'integer', 'format': 'number', 'decimals': 0},
        'price': {'kind': 'decimal', 'format': 'number', 'decimals': 2},
        'rate': {'kind': 'decimal', 'format': 'percent', 'decimals': 1},
    }
    assert abs(preview['rows'][0]['rate'] - .123) < 1e-12
    response = client.post('/api/imports/paste', json={**body, 'renames': {'rate': 'ratio'}, 'formats': {'price': {'format': 'number', 'decimals': 0}, 'ratio': {'format': 'percent', 'decimals': 2}}})
    assert response.status_code == 201, response.text
    data = response.json()
    assert data['field_formats']['ratio']['format'] == 'percent'
    assert data['field_formats']['ratio']['decimals'] == 2
    assert data['field_formats']['price']['decimals'] == 0
    rows = client.post(f"/api/datasets/{data['id']}/view-query", json={'fields': ['ratio', 'price']}).json()['rows']
    assert abs(rows[0]['ratio'] - .123) < 1e-12
    assert rows[0]['price'] == 12.3
    data = client.post('/api/imports/paste', json={**body, 'overrides': {'rate': 'string'}}).json()
    rows = client.post(f"/api/datasets/{data['id']}/view-query", json={'fields': ['rate']}).json()['rows']
    assert rows == [{'rate': '12.3%'}, {'rate': '25%'}]


def test_percent_integer_and_precision_edge_cases():
    body = {'name': 'edge', 'text': 'full\tfine\tinvalid\n100%\t0.12345\t1%%', 'preview': True}
    preview = client.post('/api/imports/paste', json=body).json()
    assert [field['type'] for field in preview['schema']] == ['number', 'number', 'string']
    assert preview['field_formats']['full']['format'] == 'percent'
    assert preview['field_formats']['fine']['decimals'] == 2


def test_uploaded_csv_formats_are_saved_with_renames():
    response = client.post('/api/imports/files', data={'name': 'csv', 'renames': '{"rate":"ratio"}', 'formats': '{"ratio":{"format":"percent","decimals":2}}'}, files={'file': ('data.csv', b'name,rate\nA,12.3%')})
    assert response.status_code == 201, response.text
    assert response.json()['field_formats']['ratio'] == {'kind': 'decimal', 'format': 'percent', 'decimals': 2}
