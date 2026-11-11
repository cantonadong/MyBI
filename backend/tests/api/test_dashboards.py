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


def test_report_tabs_survive_saving_and_publishing():
    client = TestClient(app)
    document = {
        'tabs': [{'id': 'first', 'name': 'Overview'}, {'id': 'second', 'name': 'Details'}],
        'charts': [{'id': 'chart-a', 'tabId': 'first'}, {'id': 'chart-b', 'tabId': 'second'}],
        'datasets': [], 'filters': [],
    }
    created = client.post('/api/dashboards', json={'name': 'Tabbed report', 'document': document})
    assert created.status_code == 201
    item = created.json()
    assert client.get('/api/dashboards/' + item['id']).json()['document'] == document
    published = client.post('/api/dashboards/' + item['id'] + '/publish', json={'version': item['version'], 'theme': {}})
    assert published.status_code == 200
    assert client.get('/api/dashboards/' + item['id'] + '/published').json()['document'] == document
    invalid = {**document, 'tabs': [document['tabs'][0]]}
    assert client.put('/api/dashboards/' + item['id'], json={'name': item['name'], 'document': invalid, 'version': item['version']}).status_code == 422
