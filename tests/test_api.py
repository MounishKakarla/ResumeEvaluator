import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Mock lifespan to prevent embedder loading during tests
with patch("app.main.lifespan"):
    from app.main import app

client = TestClient(app)

@patch("app.routers.auth.authenticate_user")
@patch("app.routers.auth.create_access_token")
def test_login_success(mock_create_access_token, mock_authenticate_user):
    mock_authenticate_user.return_value = MagicMock(id=1, email="admin@company.com", role="admin")
    mock_create_access_token.return_value = "fake-jwt-token"
    
    response = client.post(
        "/auth/login",
        data={"username": "admin@company.com", "password": "password"}
    )
    
    assert response.status_code == 200
    assert response.json() == {
        "access_token": "fake-jwt-token",
        "token_type": "bearer",
        "role": "admin"
    }

def test_upload_without_auth():
    # Attempt to upload without Authorization header
    response = client.post("/upload")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

from app.deps import get_current_user, get_db

def override_get_current_user():
    return MagicMock(id=1, role="admin")

def override_get_db():
    mock_db = MagicMock()
    # For /results
    # It chains: query(Evaluation).options(...).order_by(...).offset(...).limit(...).all()
    mock_query = MagicMock()
    mock_db.query.return_value = mock_query
    mock_query.options.return_value = mock_query
    mock_query.order_by.return_value = mock_query
    mock_query.offset.return_value = mock_query
    
    # Create fake evaluations
    fake_eval = MagicMock()
    fake_eval.id = 1
    fake_eval.total_score = 95
    fake_eval.candidate = MagicMock(id=1, name="John Doe", email="john@example.com")
    
    # The actual router returns pagination dict
    mock_query.limit.return_value.all.return_value = [fake_eval]
    mock_query.count.return_value = 1
    yield mock_db

app.dependency_overrides[get_current_user] = override_get_current_user
app.dependency_overrides[get_db] = override_get_db

def test_get_results():
    response = client.get("/results?page=1&limit=10")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) == 1
    assert data["items"][0]["total_score"] == 95
    assert data["items"][0]["candidate"]["name"] == "John Doe"

def test_bulk_rerun():
    response = client.post("/evaluate/bulk-rerun", json={"job_role_id": 1})
    assert response.status_code == 200
    assert "queued" in response.json()

app.dependency_overrides.clear()
