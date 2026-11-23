from fastapi.testclient import TestClient
import os
from pathlib import Path

from app.main import app


def test_health_reports_ready():
    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "pid": os.getpid(), "project_root": str(Path(__file__).resolve().parents[2])}

