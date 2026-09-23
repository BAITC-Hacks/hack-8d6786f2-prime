"""Regression checks for service duration and validation at the approval boundary."""
import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.explainer import Settings

AUTH = {"Authorization": "Bearer backend-test-token-for-temporary-database"}


def profile(**changes):
    return {"name": "Проверочный подрядчик", "city": "Алматы", "categories": ["Ведущий"],
            "event_formats": ["корпоратив"], "languages": ["русский"],
            "price_from_kzt": 100000, "max_hours": 6, "busy_dates": [],
            "description": "Проводит музыкальные викторины и интерактивные игры с гостями.",
            "contact_email": "backend-test@example.com", "synthetic": True, **changes}


@pytest.fixture
def client(tmp_path):
    app = create_app(settings=Settings(api_key=""), db_path=tmp_path / "catalog.sqlite3",
                     admin_token=AUTH["Authorization"][7:])
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("endpoint", ["/api/applications", "/api/admin/profiles"])
@pytest.mark.parametrize("categories", [["Ведущий"], ["Фотограф"], ["Декоратор", "Ведущий"]])
@pytest.mark.parametrize("omitted", [False, True])
def test_presence_requires_duration_on_both_submission_routes(client, endpoint, categories, omitted):
    body = profile(categories=categories, max_hours=None)
    if omitted:
        body.pop("max_hours")
    response = client.post(endpoint, json=body, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "max_hours"]
    assert body["contact_email"] not in response.text
    listing = client.get("/api/admin/profiles", headers=AUTH).json()
    assert listing["total"] == 66 and listing["counts"]["pending"] == 0


@pytest.mark.parametrize("endpoint", ["/api/applications", "/api/admin/profiles"])
@pytest.mark.parametrize("categories", [["Флорист"], ["Декоратор"], ["Подарки и сувениры"],
                                         ["Флорист", "Декоратор", "Подарки и сувениры"]])
def test_non_presence_services_accept_omitted_duration(client, endpoint, categories):
    body = profile(categories=categories)
    body.pop("max_hours")
    response = client.post(endpoint, json=body, headers=AUTH)
    assert response.status_code == 201, response.text
    listing = client.get("/api/admin/profiles", headers=AUTH).json()
    item = next(item for item in listing["items"] if item["id"] == response.json()["id"])
    assert item["max_hours"] is None
    if endpoint == "/api/applications":
        approved = client.post(f"/api/admin/profiles/{item['id']}/moderate", headers=AUTH,
                               json={"decision": "approved", "expected_revision": 1})
        assert approved.status_code == 200
        assert approved.json()["max_hours"] is None


def test_mixed_services_accept_numeric_duration_and_can_be_approved(client):
    response = client.post("/api/applications", json=profile(categories=["Ведущий", "Декоратор"]))
    assert response.status_code == 201
    profile_id = response.json()["id"]
    approved = client.post(f"/api/admin/profiles/{profile_id}/moderate", headers=AUTH,
                           json={"decision": "approved", "expected_revision": 1})
    assert approved.status_code == 200
    assert approved.json()["max_hours"] == 6 and approved.json()["status"] == "approved"


def test_legacy_invalid_duration_cannot_bypass_validation_at_approval(client):
    response = client.post("/api/applications", json=profile())
    assert response.status_code == 201
    profile_id = response.json()["id"]
    # Emulate a pending record saved by the previous, less strict application version.
    with client.app.state.store.connection(write=True) as conn:
        conn.execute("UPDATE profiles SET max_hours=NULL WHERE id=?", (profile_id,))
    response = client.post(f"/api/admin/profiles/{profile_id}/moderate", headers=AUTH,
                           json={"decision": "approved", "expected_revision": 1})
    assert response.status_code == 409
    assert "backend-test@example.com" not in response.text
    listing = client.get("/api/admin/profiles", headers=AUTH).json()
    item = next(item for item in listing["items"] if item["id"] == profile_id)
    assert item["status"] == "pending" and item["revision"] == 1
    with client.app.state.store.connection() as conn:
        actions = conn.execute("SELECT action FROM audit_log WHERE profile_id=?", (profile_id,)).fetchall()
    assert [row["action"] for row in actions] == ["submit"]
    # A moderator can still reject an old invalid record with a useful explanation.
    rejected = client.post(f"/api/admin/profiles/{profile_id}/moderate", headers=AUTH,
                           json={"decision": "rejected", "expected_revision": 1,
                                 "note": "Укажите длительность работы и подайте анкету заново."})
    assert rejected.status_code == 200 and rejected.json()["revision"] == 2
