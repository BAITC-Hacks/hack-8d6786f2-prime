"""Regressions from the architecture review, independent of a paid provider."""
import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.explainer import Explainer, Settings
from backend.tests.test_api import BASE
from backend.tests.test_explainer import context, provider_choices
from backend.models import Recommendation, Suggestion
from pydantic import ValidationError


def test_identical_inflight_requests_share_one_provider_call():
    catalog, query, items = context()
    calls = []

    async def handler(request):
        calls.append(request)
        await asyncio.sleep(.03)
        return httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps(provider_choices(request))}}]})

    async def run():
        engine = Explainer(Settings(api_key="test"), httpx.MockTransport(handler))
        results = await asyncio.gather(*(engine.explain(items, query, catalog.version) for _ in range(10)))
        assert len(calls) == 1
        assert all(mode == "llm" for _, mode in results)
        assert all(result == results[0][0] for result, _ in results)
        await engine.aclose()

    asyncio.run(run())


def test_date_results_explain_busy_and_rank_cutoff(tmp_path):
    with TestClient(create_app(db_path=tmp_path / "catalog.sqlite3", settings=Settings())) as client:
        first = client.post("/api/recommend", json=BASE).json()
        second = client.post("/api/recommend", json={**BASE, "date": "2026-11-15"}).json()
    before = {row["id"]: row for row in first["assessments"]}
    after = {row["id"]: row for row in second["assessments"]}
    assert before["HK-29829"]["status"] == "selected"
    assert after["HK-29829"]["reasons"] == ["busy"]
    assert "busy" in before["HK-88430"]["reasons"]
    assert after["HK-88430"]["status"] == "selected"
    assert after["HK-27222"]["status"] == "not_selected"
    assert after["HK-27222"]["rank"] > 3
    assert after["HK-27222"]["reasons"] == []


def test_catalog_reads_reuse_snapshot_and_refresh_is_explicit(tmp_path):
    app = create_app(db_path=tmp_path / "catalog.sqlite3", settings=Settings())
    store = app.state.store
    first = store.snapshot()
    assert store.snapshot() is first
    with store.connection(write=True) as conn:
        conn.execute("UPDATE profiles SET description='Обновлённое описание' WHERE id=?", (first.records[0].id,))
    assert store.snapshot() is first
    refreshed = store.refresh()
    assert refreshed is store.snapshot() and refreshed.version != first.version
    assert first.records[0].description != refreshed.records[0].description


def test_ai_concurrency_limit_and_deadline_cover_waiting():
    catalog, query, items = context()
    active = maximum = calls = 0

    async def handler(request):
        nonlocal active, maximum, calls
        active += 1
        calls += 1
        maximum = max(maximum, active)
        try:
            await asyncio.sleep(2)
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(provider_choices(request))}}]})
        finally:
            active -= 1

    async def run():
        engine = Explainer(Settings(api_key="test", max_concurrency=2, timeout=.2), httpx.MockTransport(handler))
        started = time.perf_counter()
        results = await asyncio.gather(*(engine.explain(items, query.model_copy(update={"budget_kzt": 2000000 + i}), catalog.version) for i in range(10)))
        assert time.perf_counter() - started < 1
        assert maximum == 2 and calls <= 4
        assert {mode for _, mode in results} == {"fallback"}
        assert all(len(result) == 3 for result, _ in results)
        await engine.aclose()
        assert not engine._inflight and engine._client is None

    asyncio.run(run())


def test_circuit_falls_back_immediately_then_recovers():
    catalog, query, items = context()
    calls = []

    async def handler(request):
        calls.append(request)
        if len(calls) <= 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(provider_choices(request))}}]})

    async def run():
        engine = Explainer(Settings(api_key="test", cooldown=.04), httpx.MockTransport(handler))
        for _ in range(3):
            assert (await engine.explain(items, query, catalog.version))[1] == "fallback"
        details = {}
        assert (await engine.explain(items, query, catalog.version, diagnostics=details))[1] == "fallback"
        assert details["fallback_reason"] == "circuit_open" and len(calls) == 3
        await asyncio.sleep(.05)
        assert (await engine.explain(items, query, catalog.version))[1] == "llm"
        client = engine._client
        await engine.explain(items, query.model_copy(update={"budget_kzt": 1600000}), catalog.version)
        assert engine._client is client and len(calls) == 5
        await engine.aclose()

    asyncio.run(run())


@pytest.mark.parametrize("setting,reason", [("calls_per_minute", "rate_limit"), ("calls_per_session", "session_budget")])
def test_provider_call_budget_preserves_cached_and_fallback_results(setting, reason):
    catalog, query, items = context()

    async def run():
        engine = Explainer(Settings(api_key="test", **{setting: 1}), httpx.MockTransport(lambda r:
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(provider_choices(r))}}]})))
        await engine.explain(items, query, catalog.version)
        diagnostics = {}
        _, mode = await engine.explain(items, query, catalog.version, diagnostics=diagnostics)
        assert mode == "llm" and diagnostics["cache_hit"]
        _, mode = await engine.explain(items, query.model_copy(update={"budget_kzt": 1600000}), catalog.version, diagnostics=diagnostics)
        assert mode == "fallback" and diagnostics["fallback_reason"] == reason
        assert engine._total_calls == 1
        await engine.aclose()

    asyncio.run(run())


def test_cancelled_waiter_does_not_cancel_shared_provider_request():
    catalog, query, items = context()

    async def run():
        engine = Explainer(Settings(api_key="test"))
        started, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def request(*args):
            from backend.explainer import excerpts, fallback_choice
            calls.append(True)
            started.set()
            await release.wait()
            return [fallback_choice(row, query, excerpts(row.description), items) for row in items]

        engine._request = request
        first = asyncio.create_task(engine.explain(items, query, catalog.version))
        await started.wait()
        second = asyncio.create_task(engine.explain(items, query, catalog.version))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        assert (await second)[1] == "llm" and len(calls) == 1
        await engine.aclose()

    asyncio.run(run())


def test_response_contract_rejects_inconsistent_status_counts_and_extra_card(tmp_path):
    with TestClient(create_app(db_path=tmp_path / "c.sqlite3", settings=Settings())) as client:
        response = client.post("/api/recommend", json=BASE).json()
    for changes in [{"status": "no_match"}, {"total_in_category": 0}, {"eligible_count": 2},
                    {"cards": response["cards"] + response["cards"][:1]}, {"assessments": []}]:
        with pytest.raises(ValidationError):
            Recommendation.model_validate({**response, **changes})


@pytest.mark.parametrize("changes", [{}, {"city": "Алматы"}, {"category": "Флорист"}, {"event_type": "свадьба"},
                                     {"date": "2026-02-31"}, {"budget_kzt": True}, {"duration_hours": -1}])
def test_changes_contract_rejects_undeclared_or_invalid_conditions(changes):
    with pytest.raises(ValidationError):
        Suggestion(label="bad", changes=changes)


def test_env_example_placeholder_does_not_enable_paid_requests(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "PASTE_YOUR_OPENAI_API_KEY_HERE")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert not Settings.from_env().available
