from fastapi.testclient import TestClient

from app.main import app
from app.api import profile


def test_manager_locale_is_validated_and_persisted(tmp_path, monkeypatch):
    destination = tmp_path / 'data' / 'manager-locale.txt'
    monkeypatch.setattr(profile, 'MANAGER_LOCALE_PATH', destination)
    client = TestClient(app)
    assert client.put('/api/profile/locale', json={'locale': 'zh-CN'}).status_code == 200
    assert destination.read_text(encoding='utf-8') == 'zh-CN'
    assert client.put('/api/profile/locale', json={'locale': 'en'}).status_code == 200
    assert destination.read_text(encoding='utf-8') == 'en'
    assert client.put('/api/profile/locale', json={'locale': '../../invalid'}).status_code == 422
    assert destination.read_text(encoding='utf-8') == 'en'
