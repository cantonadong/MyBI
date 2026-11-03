from fastapi.testclient import TestClient
from app.main import app

def test_dashboard_roundtrip_and_conflict():
    client = TestClient(app)
    body = {"name": "test", "document": {"charts": [{"id": "a", "filterMode": "both", "filters": []}], "filters": []}}
    created = client.post('/api/dashboards', json=body)
    assert created.status_code == 201
    item = created.json()
    assert client.get('/api/dashboards/' + item['id']).json()['document'] == body['document']
    assert client.put('/api/dashboards/' + item['id'], json={**body, 'version': 0}).status_code == 409
