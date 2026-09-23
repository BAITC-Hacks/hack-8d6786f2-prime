from fastapi.testclient import TestClient

from backend.app import create_app
from backend.explainer import Settings
from backend.tests.test_api import BASE


def test_deleted_profile_is_removed_even_while_explanation_is_in_flight(tmp_path):
    app = create_app(settings=Settings(api_key=""), db_path=tmp_path / "race.sqlite3", admin_token="")
    engine = app.state.explainer
    original = engine.explain
    removed = []

    async def remove_during_explanation(items, query, version):
        explanation = await original(items, query, version)
        removed.append(items[0].id)
        app.state.store.delete(items[0].id, expected_revision=1)
        return explanation

    engine.explain = remove_during_explanation
    response = TestClient(app).post("/api/recommend", json=BASE)
    assert response.status_code == 200
    data = response.json()
    assert data["eligible_count"] == 3 and len(data["cards"]) == 3
    assert removed[0] not in [card["id"] for card in data["cards"]]
    assert data["meta"]["dataset_version"] == app.state.store.snapshot().version
    assert data["meta"]["explanation_mode"] == "fallback"
