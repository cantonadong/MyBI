from fastapi.testclient import TestClient

from app.main import app


def test_paste_import_publishes_reopenable_dataset():
    client = TestClient(app)
    response = client.post("/api/imports/paste", json={"name": "sales", "text": "region\tamount\nNorth\t12.5\nSouth\t0"})

    assert response.status_code == 201
    dataset = response.json()
    assert dataset["name"] == "sales"
    assert dataset["row_count"] == 2
    assert dataset["schema"] == [{"name": "region", "type": "string"}, {"name": "amount", "type": "number"}]

    reopened = client.get(f"/api/datasets/{dataset['id']}")
    assert reopened.status_code == 200
    assert reopened.json()["snapshot_id"] == dataset["snapshot_id"]


def test_view_query_filters_without_accepting_sql():
    client = TestClient(app)
    dataset = client.post("/api/imports/paste", json={"name": "sales", "text": "region\tamount\nNorth\t12.5\nSouth\t0"}).json()
    response = client.post(f"/api/datasets/{dataset['id']}/view-query", json={"fields": ["region", "amount"], "filters": [{"field": "amount", "op": "between", "value": [1, 20]}], "limit": 10})

    assert response.status_code == 200
    assert response.json()["rows"] == [{"region": "North", "amount": 12.5}]
    assert response.json()["snapshot_id"] == dataset["snapshot_id"]


def test_pasted_thousands_are_numeric_in_preview_and_saved_data():
    client = TestClient(app)
    request = {'name': 'grouped', 'text': 'amount\n1,026\n-12,345.67'}
    preview = client.post('/api/imports/paste', json={**request, 'preview': True}).json()
    assert preview['schema'] == [{'name': 'amount', 'type': 'integer'}]
    assert preview['rows'] == [{'amount': 1026}, {'amount': -12345.67}]
    assert client.post('/api/imports/paste', json=request).status_code == 422
    data = client.post('/api/imports/paste', json={**request, 'overrides': {'amount': 'number'}}).json()
    response = client.post(f"/api/datasets/{data['id']}/view-query", json={'fields': ['amount']})
    assert response.json()['rows'] == preview['rows']
    data = client.post('/api/imports/paste', json={**request, 'overrides': {'amount': 'string'}}).json()
    response = client.post(f"/api/datasets/{data['id']}/view-query", json={'fields': ['amount']})
    assert response.json()['rows'] == [{'amount': '1,026'}, {'amount': '-12,345.67'}]
