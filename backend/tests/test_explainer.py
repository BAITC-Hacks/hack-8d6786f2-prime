import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from backend.catalog import Catalog
from backend.explainer import Choice, Explainer, Settings, compose, excerpts, fallback_choice
from backend.models import Query
from backend.recommender import select
from backend.tests.test_api import BASE


def context():
    catalog = Catalog(Path(__file__).resolve().parents[2] / "data" / "contractors.csv")
    query = Query(**BASE)
    return catalog, query, select(catalog, query).eligible[:3]


@pytest.mark.parametrize("invitation", [
    "Свяжитесь с нами, чтобы заказать незабываемый корпоратив с юмором и интерактивом",
    "Закажите корпоратив с юмором, интерактивом и танцами прямо сейчас",
    "Оставьте заявку на корпоратив с юмором и незабываемыми впечатлениями",
    "Бронируйте корпоратив с юмором и интерактивом для всех ваших гостей",
    "Готовы выступить на вашем мероприятии и подарить незабываемый корпоратив с юмором",
])
def test_fallback_prefers_service_detail_even_when_invitation_matches_preferences(invitation):
    _, query, items = context()
    query = query.model_copy(update={"preferences": "корпоратив с юмором и интерактивом"})
    detail = "В составе ансамбля четыре вокалиста и два инструменталиста"
    item = replace(items[0], description=f"{invitation}. {detail}.")
    snippets = excerpts(item.description)
    selected = fallback_choice(item, query, snippets)
    assert snippets[selected.snippet_index] == detail
    assert fallback_choice(item, query, snippets) == selected


def test_fallback_keeps_source_evidence_when_only_sales_text_is_available():
    _, query, items = context()
    item = replace(items[0], description="Свяжитесь с нами, чтобы обсудить ваше мероприятие.")
    snippets = excerpts(item.description)
    selected = fallback_choice(item, query, snippets)
    explanation, evidence = compose(item, query, selected, snippets)
    assert evidence[0].value in item.description
    assert "вокалист" not in explanation and "инструменталист" not in explanation


def test_provider_success_cache_and_server_owned_facts():
    catalog, query, items = context()
    calls = []
    def handler(request):
        calls.append(request)
        content = {"items": [{"id": r.id, "snippet_index": 0, "highlight": "budget"} for r in reversed(items)]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})
    engine = Explainer(Settings(api_key="test-not-a-real-key"), httpx.MockTransport(handler))
    result, mode = asyncio.run(engine.explain(items, query, catalog.version))
    cached, cached_mode = asyncio.run(engine.explain(items, query, catalog.version))
    assert mode == cached_mode == "llm"
    assert result == cached and len(calls) == 1
    assert list(result) == [r.id for r in items]
    for item in items:
        assert result[item.id][1][0].value in item.description


def test_untrusted_model_response_cannot_add_candidates():
    catalog, query, items = context()
    payload = {"items": [{"id": "invented-id", "snippet_index": 0, "highlight": "budget"}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}))
    result, mode = asyncio.run(Explainer(Settings(api_key="test"), transport).explain(items, query, catalog.version))
    assert mode == "fallback"
    assert set(result) == {r.id for r in items}


def test_missing_source_excerpt_falls_back():
    catalog, query, items = context()
    payload = {"items": [{"id": r.id, "snippet_index": 999999, "highlight": "budget"} for r in items]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}))
    _, mode = asyncio.run(Explainer(Settings(api_key="test"), transport).explain(items, query, catalog.version))
    assert mode == "fallback"


def test_provider_error_does_not_hide_matches():
    catalog, query, items = context()
    engine = Explainer(Settings(api_key="test"), httpx.MockTransport(lambda r: httpx.Response(429)))
    result, mode = asyncio.run(engine.explain(items, query, catalog.version))
    assert mode == "fallback" and len(result) == 3 and not engine.cache


def test_total_timeout_returns_fallback():
    catalog, query, items = context()
    engine = Explainer(Settings(api_key="test", timeout=0.01))
    async def slow(*args):
        await asyncio.sleep(1)
    engine._request = slow
    result, mode = asyncio.run(engine.explain(items, query, catalog.version))
    assert mode == "fallback" and len(result) == 3


def test_budget_equality_has_truthful_wording():
    _, query, items = context()
    item = items[0]
    query = query.model_copy(update={"budget_kzt": item.price_from_kzt})
    explanation, _ = compose(item, query, Choice(id=item.id, snippet_index=0, highlight="budget"), excerpts(item.description))
    assert "равна предельному бюджету" in explanation
    assert "на 0" not in explanation


def test_credentials_are_hidden_in_settings_repr():
    assert "private-value" not in repr(Settings(api_key="private-value"))


def test_provider_errors_never_log_response_body(caplog):
    catalog, query, items = context()
    engine = Explainer(Settings(api_key="private-value"), httpx.MockTransport(
        lambda r: httpx.Response(401, json={"error": {"message": "Your key is private-value"}})))
    _, mode = asyncio.run(engine.explain(items, query, catalog.version))
    assert mode == "fallback" and "http_status=401" in caplog.text
    assert "private-value" not in caplog.text


@pytest.mark.parametrize("content", ["not json", '{"items":[]}', '{"items":[{"id":"x","snippet_index":true,"highlight":"budget"}]}'])
def test_malformed_model_output_falls_back(content):
    catalog, query, items = context()
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": content}}]}))
    _, mode = asyncio.run(Explainer(Settings(api_key="test"), transport).explain(items, query, catalog.version))
    assert mode == "fallback"


def test_nvidia_endpoint_and_json_handling():
    catalog, query, items = context()
    def handler(request):
        assert str(request.url) == "https://integrate.api.nvidia.com/v1/chat/completions"
        body = json.loads(request.content)
        assert body["model"] == "test/model" and "max_tokens" in body
        result = {"items": [{"id": r.id, "snippet_index": 0, "highlight": "event_type"} for r in items]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(result)}}]})
    _, mode = asyncio.run(Explainer(Settings(provider="nvidia", model="test/model", api_key="test"),
                                   httpx.MockTransport(handler)).explain(items, query, catalog.version))
    assert mode == "llm"


def test_no_network_call_for_empty_selection():
    catalog, query, _ = context()
    def handler(request):
        raise AssertionError("Empty selection must not call the model")
    result, mode = asyncio.run(Explainer(Settings(api_key="test"), httpx.MockTransport(handler)).explain([], query, catalog.version))
    assert result == {} and mode == "fallback"


@pytest.mark.parametrize("timeout", ["nan", "inf", "0", "-1"])
def test_invalid_timeout_is_rejected(monkeypatch, timeout):
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", timeout)
    with pytest.raises(ValueError):
        Settings.from_env()
