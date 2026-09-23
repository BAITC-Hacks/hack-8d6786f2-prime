"""Independent HTTP acceptance against a separate process and disposable SQL database."""
from contextlib import contextmanager
import csv
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
QUERY = {"city": "Алматы", "date": "2026-11-14", "event_type": "корпоратив",
         "category": "Ведущий", "budget_kzt": 1500000, "duration_hours": 6,
         "language": "русский"}

def stop_process(process):
    """A Windows venv executable may delegate to another Python process."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        result = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            process.terminate()
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


@contextmanager
def isolated_server(database: Path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ, DATABASE_PATH=str(database), PYTHON_DOTENV_DISABLED="1",
               OPENAI_API_KEY="", NVIDIA_API_KEY="", LLM_PROVIDER="openai",
               CONTRACTORS_CSV=str(ROOT / "data" / "contractors.csv"))
    log = database.with_suffix(".server.log")
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=15) as client:
                for _ in range(100):
                    if process.poll() is not None:
                        pytest.fail("Isolated backend failed to start: " + log.read_text(encoding="utf-8"))
                    try:
                        if client.get("/api/health").status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(.1)
                else:
                    pytest.fail("Isolated backend did not become ready")
                yield client
        finally:
            stop_process(process)


@pytest.fixture(scope="module")
def api(tmp_path_factory):
    with isolated_server(tmp_path_factory.mktemp("recommendation-http") / "catalog.sqlite3") as client:
        yield client


def recommend(api, **changes):
    response = api.post("/api/recommend", json={**QUERY, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def ids(result):
    return [card["id"] for card in result["cards"]]


def test_original_case_dense_rare_and_empty(api):
    dense = recommend(api)
    assert ids(dense) == ["HK-44923", "HK-29829", "HK-27222"]
    assert dense["eligible_count"] == 4
    assert dense["meta"]["latency_ms"] < 10000
    assert len({card["explanation"] for card in dense["cards"]}) == 3
    assert all(card["explanation"] and card["evidence"] for card in dense["cards"])
    rare = recommend(api, category="Флорист", event_type="свадьба", budget_kzt=300000,
                     duration_hours=8, language=None)
    assert ids(rare) == ["HK-90001"] and rare["cards"][0]["synthetic"] is True
    assert rare["cards"][0]["max_hours"] is None
    absent = recommend(api, city="Астана", category="Декоратор")
    blocked = recommend(api, budget_kzt=10000)
    assert absent["status"] == "no_category" and blocked["status"] == "no_match"
    assert absent["summary"] and blocked["summary"] and absent["summary"] != blocked["summary"]
    assert absent["cards"] == blocked["cards"] == []
    assert not absent.get("alternatives")


def test_all_alternatives_are_honest_and_replayable(api):
    with (ROOT / "data" / "contractors.csv").open(encoding="utf-8-sig", newline="") as handle:
        source = {row["id"]: row for row in csv.DictReader(handle)}
    for budget, language, hours, day in [(600000, "русский", 6, "2026-11-14"),
                                         (1, "английский", 24, "2026-12-31"),
                                         (10000, "казахский", 8, "2026-09-23")]:
        query = {**QUERY, "budget_kzt": budget, "language": language, "duration_hours": hours, "date": day}
        result = recommend(api, **query)
        assert result["status"] == "no_match" and result["cards"] == []
        assert result["eligible_count"] == 0
        alternatives = result["alternatives"]
        assert 1 <= len(alternatives) <= 3
        assert len({a["card"]["id"] for a in alternatives}) == len(alternatives)
        again = recommend(api, **query)
        assert alternatives == again["alternatives"]
        for alternative in alternatives:
            card, changes = alternative["card"], alternative["changes"]
            assert changes and set(changes) <= {"date", "budget_kzt", "language", "duration_hours"}
            assert all(value != query[key] for key, value in changes.items())
            differences = alternative["differences"]
            assert {difference["field"] for difference in differences} == set(changes)
            assert all(d["requested"] != d["proposed"] and d["reason"] for d in differences)
            proposal = {**query, **changes}
            original = source[card["id"]]
            assert card["city"] == query["city"] and query["category"] in card["categories"]
            assert query["event_type"] in original["event_formats"].split("|")
            assert card["available_on"] == proposal["date"]
            assert proposal["date"] not in original["busy_dates"].split("|")
            assert "2026-09-23" <= proposal["date"] <= "2026-12-31"
            assert card["price_from_kzt"] <= proposal["budget_kzt"]
            assert proposal["language"] is None or proposal["language"] in card["languages"]
            assert proposal["duration_hours"] is None or card["max_hours"] is None or proposal["duration_hours"] <= card["max_hours"]
            assert alternative["explanation_mode"] == "fallback"
            assert recommend(api, **proposal)["eligible_count"] >= 1
    assert ids(recommend(api, budget_kzt=600000, date="2026-11-15")) == ["HK-88430"]


def test_order_and_catalog_survive_process_restart(tmp_path):
    database = tmp_path / "persistent.sqlite3"
    with isolated_server(database) as api:
        original = recommend(api)
    with isolated_server(database) as api:
        repeated = recommend(api)
        assert ids(original) == ids(repeated)
        assert original["meta"]["dataset_version"] == repeated["meta"]["dataset_version"]
        assert api.get("/api/options").json()["dataset"]["profiles_count"] == 66
    with sqlite3.connect(database) as sql:
        assert sql.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert sql.execute("PRAGMA foreign_key_check").fetchall() == []


def test_only_recommendation_endpoints_are_available(api):
    paths = api.get("/openapi.json").json()["paths"]
    assert set(paths) == {"/api/health", "/api/options", "/api/recommend"}
    for method, path in [("GET", "/api/admin/profiles"), ("POST", "/api/applications"),
                         ("DELETE", "/api/admin/profiles/HK-44923")]:
        assert api.request(method, path).status_code in {404, 405}
    assert api.post("/api/recommend", json={**QUERY, "preferences": "Нужен юмор"}).status_code == 422
    assert api.post("/api/recommend", content=b"x" * 65537,
                    headers={"Content-Type": "application/json"}).status_code == 413
