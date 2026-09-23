from dataclasses import replace
import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.explainer import Settings
from backend.models import Query
from backend.recommender import rejection_reasons

BASE = {"city": "Алматы", "date": "2026-11-14", "event_type": "корпоратив",
        "category": "Ведущий", "budget_kzt": 1500000, "duration_hours": 6,
        "language": "русский"}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(settings=Settings(api_key=""), db_path=tmp_path / "catalog.sqlite3"))


def recommend(client, **updates):
    response = client.post("/api/recommend", json={**BASE, **updates})
    assert response.status_code == 200, response.text
    return response.json()


def test_catalog_options(client):
    options = client.get("/api/options").json()
    assert options["dataset"]["profiles_count"] == 66
    assert len(options["categories"]) == 17
    assert options["calendar"] == {"min": "2026-09-23", "max": "2026-12-31"}
    assert client.get("/api/health").json()["ai_available"] is False


def test_dense_category_and_stable_order(client):
    result = recommend(client)
    assert result["status"] == "matched"
    assert result["total_in_category"] == 10
    assert result["eligible_count"] == 4
    assert [r["id"] for r in result["cards"]] == ["HK-44923", "HK-29829", "HK-27222"]
    assert [r["id"] for r in recommend(client)["cards"]] == [r["id"] for r in result["cards"]]
    restarted = TestClient(create_app(settings=Settings(api_key=""), db_path=client.app.state.store.path))
    assert [r["id"] for r in recommend(restarted)["cards"]] == [r["id"] for r in result["cards"]]
    assert result["meta"]["explanation_mode"] == "fallback"
    for card in result["cards"]:
        assert card["explanation"]
        assert card["evidence"][0]["value"] in card["description"]


def test_date_change_and_verified_suggestion(client):
    result = recommend(client, budget_kzt=600000)
    assert result["status"] == "no_match" and result["cards"] == []
    assert result["suggestions"][0]["changes"] == {"date": "2026-11-15"}
    next_day = recommend(client, budget_kzt=600000, date="2026-11-15")
    assert next_day["eligible_count"] == 1
    assert next_day["cards"][0]["id"] == "HK-88430"


def test_rare_category_null_duration_and_provenance(client):
    result = recommend(client, category="Флорист", event_type="свадьба", budget_kzt=300000,
                       duration_hours=8, language=None)
    assert result["eligible_count"] == 1
    assert result["cards"][0]["id"] == "HK-90001"
    assert result["cards"][0]["synthetic"] is True
    assert result["cards"][0]["max_hours"] is None


def test_empty_states(client):
    absent = recommend(client, city="Астана", category="Декоратор")
    blocked = recommend(client, budget_kzt=10000)
    assert absent["status"] == "no_category" and absent["total_in_category"] == 0
    assert blocked["status"] == "no_match" and blocked["total_in_category"] == 10
    assert absent["summary"] != blocked["summary"]
    assert not absent["cards"] and not blocked["cards"]


@pytest.mark.parametrize("update", [{"date": "2027-01-01"}, {"date": "2026-09-22"},
                                      {"budget_kzt": 0}, {"duration_hours": 0},
                                      {"city": "Несуществующий город"}, {"language": "несуществующий"},
                                      {"budget_kzt": True}, {"event_type": "неизвестное"}])
def test_invalid_queries(client, update):
    assert client.post("/api/recommend", json={**BASE, **update}).status_code == 422


def test_budget_and_duration_boundaries(client):
    result = recommend(client, budget_kzt=500000, date="2026-11-15")
    assert result["eligible_count"] == 1
    assert recommend(client, budget_kzt=499999, date="2026-11-15")["eligible_count"] == 0
    assert recommend(client, budget_kzt=500000, date="2026-11-15", duration_hours=6.1)["eligible_count"] == 0
    assert recommend(client, budget_kzt=500000, date="2026-11-15", language="казахский")["eligible_count"] == 0


def test_venue_calendar_and_multi_category(client):
    item = next(r for r in client.app.state.catalog.records if "Банкетный зал" in r.categories and len(r.categories) > 1)
    query = Query(city=item.city, date=min(item.busy_dates), event_type=item.event_formats[0],
                  category="Банкетный зал", budget_kzt=item.price_from_kzt)
    assert "busy" in rejection_reasons(item, query)
    assert rejection_reasons(replace(item, busy_dates=frozenset()), query) == []


def test_incomplete_results_explain_actual_constraint(client):
    result = recommend(client, category="Флорист", event_type="свадьба", budget_kzt=300000,
                       duration_hours=8, language=None)
    assert result["total_in_category"] == 2 and result["eligible_count"] == 1
    assert "заняты на выбранную дату — 1" in result["summary"]
    assert "отсутствуют в каталоге или" not in result["summary"]


def test_small_catalog_is_not_described_as_rejected(client):
    result = recommend(client, city="Астана", category="Флорист", event_type="свадьба",
                       budget_kzt=300000, duration_hours=None, language=None)
    assert result["eligible_count"] == result["total_in_category"] == 1
    assert "в каталоге всего 1" in result["summary"]
    assert "Причины исключения" not in result["summary"]


@pytest.mark.parametrize("update", [{"duration_hours": True}, {"duration_hours": "6"},
                                      {"date": 1794614400}, {"date": "2026-11-14T00:00:00"}])
def test_input_types_match_contract(client, update):
    assert client.post("/api/recommend", json={**BASE, **update}).status_code == 422


def test_explanation_uses_specific_detail_not_greeting(client):
    result = recommend(client)
    mitsuri = next(card for card in result["cards"] if card["id"] == "HK-44923")
    assert "DJ и современная танцевальная музыка и мультимедийное оборудование" in mitsuri["explanation"]
    assert mitsuri["evidence"][0]["value"] in mitsuri["description"]
    assert "Приветствую всех" not in mitsuri["explanation"]


def test_ensemble_explanation_uses_description_instead_of_sales_invitation(client):
    result = recommend(client, category="Национальный ансамбль", event_type="той",
                       budget_kzt=400000, duration_hours=2, language="казахский")
    card = next(card for card in result["cards"] if card["id"] == "HK-19103")
    assert result["meta"]["explanation_mode"] == "fallback"
    assert "энергичная команда джигитов" in card["explanation"]
    assert "свяжитесь с нами" not in card["explanation"]
    assert card["evidence"][0]["value"] in card["description"]


def test_openapi_contains_typed_options_and_health(client):
    schema = client.get("/openapi.json").json()
    assert "profiles_count" in schema["components"]["schemas"]["DatasetInfo"]["properties"]
    assert "ai_available" in schema["components"]["schemas"]["Health"]["properties"]
