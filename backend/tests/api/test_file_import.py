from fastapi.testclient import TestClient

from app.main import app


def test_csv_file_import():
    response = TestClient(app).post("/api/imports/files", data={"name": "orders"}, files={"file": ("orders.csv", b"item,amount\nA,3\nB,4", "text/csv")})

    assert response.status_code == 201
    assert response.json()["row_count"] == 2
    assert response.json()["schema"][1] == {"name": "amount", "type": "integer"}
