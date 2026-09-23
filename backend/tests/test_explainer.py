import asyncio
import json

import httpx

from backend.app import create_app
from backend.explainer import Explainer, Settings
from backend.models import Query
from backend.recommender import select
from backend.tests.test_api import BASE


def context():
    catalog = create_app(settings=Settings()).state.catalog
    query = Query(**BASE)
    return catalog, query, select(catalog, query).eligible[:3]


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
