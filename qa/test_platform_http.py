"""Independent black-box acceptance checks; every server uses a disposable SQL DB.

Run from the repository root: python -m pytest qa/test_platform_http.py -q
No application implementation or real .env values are imported by this suite.
"""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import csv
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
import uuid

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[1]
TOKEN = "qa-only-disposable-admin-token-" + "x" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
QUERY = {"city": "Алматы", "date": "2026-11-14", "event_type": "корпоратив",
         "category": "Ведущий", "budget_kzt": 1500000, "duration_hours": 6,
         "language": "русский", "preferences": ""}


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


def profile(**changes):
    marker = uuid.uuid4().hex[:12]
    return {"name": f"QA кандидат {marker}", "city": "Алматы", "categories": ["Ведущий"],
            "event_formats": ["корпоратив"], "languages": ["русский"],
            "price_from_kzt": 1, "max_hours": 8, "busy_dates": [],
            "description": "Авторская программа: музыкальная викторина и интерактивные игры с гостями.",
            "contact_email": f"qa-{marker}@example.com", "synthetic": True, **changes}


@contextmanager
def isolated_server(database: Path, token=TOKEN):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ, DATABASE_PATH=str(database), ADMIN_API_TOKEN=token,
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
    with isolated_server(tmp_path_factory.mktemp("platform-http") / "catalog.sqlite3") as client:
        yield client


@pytest.fixture
def created(api):
    ids = []
    yield ids
    listing = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 100}).json()
    for item in listing.get("items", []):
        if item["id"] in ids:
            response = api.delete(f"/api/admin/profiles/{item['id']}", headers=AUTH,
                                  params={"expected_revision": item["revision"]})
            assert response.status_code == 204, response.text


def post_profile(api, created, body=None, admin=False):
    response = api.post("/api/admin/profiles" if admin else "/api/applications",
                        headers=AUTH if admin else {}, json=body or profile())
    assert response.status_code == 201, response.text
    created.append(response.json()["id"])
    return response.json()


def recommend(api, **changes):
    response = api.post("/api/recommend", json={**QUERY, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def lookup(api, id):
    records = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 100}).json()
    return next(item for item in records["items"] if item["id"] == id)


def moderate(api, item, decision, note="Проверено QA"):
    return api.post(f"/api/admin/profiles/{item['id']}/moderate", headers=AUTH,
                    json={"decision": decision, "expected_revision": item["revision"], "note": note})


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


def test_all_66_seed_profiles_preserve_their_data_and_admin_schema(api):
    result = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 100})
    assert result.status_code == 200
    listing = result.json()
    assert listing["total"] == 66 and listing["counts"] == {"pending": 0, "approved": 66, "rejected": 0}
    items = {item["id"]: item for item in listing["items"]}
    with (ROOT / "data" / "contractors.csv").open(encoding="utf-8-sig", newline="") as handle:
        source = {row["id"]: row for row in csv.DictReader(handle)}
    assert set(items) == set(source)
    fields = {"id", "name", "city", "categories", "event_formats", "languages", "price_from_kzt",
              "max_hours", "busy_dates", "description", "contact_email", "synthetic", "price_imputed",
              "city_imputed", "status", "source", "revision", "created_at", "updated_at", "moderation_note"}
    for id, item in items.items():
        row = source[id]
        assert set(item) == fields
        assert item["name"] == row["anon_name"].strip() and item["description"] == row["description"].strip()
        assert item["city"] == row["city"].strip() and item["price_from_kzt"] == int(row["price_from_kzt"])
        assert item["max_hours"] == (float(row["max_hours"]) if row["max_hours"] else None)
        for field in ("categories", "event_formats", "languages", "busy_dates"):
            assert set(item[field]) == set(value.strip() for value in row[field].split("|") if value.strip())
        for field in ("synthetic", "price_imputed", "city_imputed"):
            assert item[field] is (row[field] == "True")
        assert item["contact_email"] is None and item["source"] == "dataset" and item["status"] == "approved"
        assert item["revision"] == 1 and item["created_at"] and item["updated_at"]


def test_entire_application_moderation_lifecycle_and_public_privacy(api, created):
    original = recommend(api)
    payload = profile()
    pending = post_profile(api, created, payload)
    assert pending["status"] == "pending"
    before = recommend(api)
    assert pending["id"] not in ids(before)
    assert before["meta"]["dataset_version"] == original["meta"]["dataset_version"]
    assert ids(before) == ids(original)
    assert api.post("/api/applications", json=payload).status_code == 409
    item = lookup(api, pending["id"])
    assert item["contact_email"] == payload["contact_email"] and item["source"] == "application"
    approved = moderate(api, item, "approved")
    assert approved.status_code == 200, approved.text
    item = approved.json()
    result = recommend(api)
    assert pending["id"] == ids(result)[0]
    assert result["meta"]["dataset_version"] != original["meta"]["dataset_version"]
    assert result["cards"][0]["synthetic"] is True
    public = json.dumps([result, api.get("/api/options").json(), api.get("/api/health").json()])
    assert payload["contact_email"] not in public
    for forbidden in ["contact_email", "password", "ADMIN_API_TOKEN", "OPENAI_API_KEY", TOKEN]:
        assert forbidden not in public
    rejected = moderate(api, item, "rejected", "Проверка отклонения")
    assert rejected.status_code == 200
    assert pending["id"] not in ids(recommend(api))
    assert moderate(api, rejected.json(), "approved").status_code == 200
    latest = lookup(api, pending["id"])
    deleted = api.delete(f"/api/admin/profiles/{pending['id']}", headers=AUTH,
                         params={"expected_revision": latest["revision"]})
    assert deleted.status_code == 204 and deleted.content == b""
    assert pending["id"] not in ids(recommend(api))
    assert all(row["id"] != pending["id"] for row in api.get("/api/admin/profiles", headers=AUTH).json()["items"])


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/api/admin/profiles", None), ("POST", "/api/admin/profiles", profile()),
    ("POST", "/api/admin/profiles/HK-44923/moderate", {"decision": "rejected", "expected_revision": 1, "note": "No"}),
    ("DELETE", "/api/admin/profiles/HK-44923?expected_revision=1", None),
])
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid-test-token"}])
def test_all_admin_actions_require_token(api, method, path, payload, headers):
    result = api.request(method, path, json=payload, headers=headers)
    assert result.status_code == 401, result.text
    assert isinstance(result.json()["detail"], str)
    assert TOKEN not in result.text


def test_admin_without_server_token_is_disabled(tmp_path):
    with isolated_server(tmp_path / "disabled.sqlite3", token="") as client:
        response = client.get("/api/admin/profiles", headers=AUTH)
        assert response.status_code == 503
        assert isinstance(response.json()["detail"], str)


def test_unknown_profile_and_private_validation_responses(api):
    missing = "USR-nonexistent-qa-profile"
    assert api.delete(f"/api/admin/profiles/{missing}", headers=AUTH,
                      params={"expected_revision": 1}).status_code == 404
    assert api.post(f"/api/admin/profiles/{missing}/moderate", headers=AUTH,
                    json={"decision": "approved", "expected_revision": 1}).status_code == 404
    marker = "must-not-reflect-private-password-qa"
    response = api.post("/api/applications", json=profile(password=marker))
    assert response.status_code == 422 and marker not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    oversized = api.post("/api/applications", content=b"x" * 65537,
                         headers={"Content-Type": "application/json"})
    assert oversized.status_code == 413


BAD_APPLICATIONS = [
    {"name": " "}, {"name": "x" * 121}, {"description": "short"}, {"description": "x" * 3001},
    {"price_from_kzt": True}, {"price_from_kzt": "100"}, {"price_from_kzt": 1.5},
    {"price_from_kzt": 0}, {"price_from_kzt": -1}, {"price_from_kzt": 1000000001},
    {"max_hours": True}, {"max_hours": "6"}, {"max_hours": 0}, {"max_hours": 24.1},
    {"city": "Неизвестный город"}, {"categories": []}, {"categories": ["Неизвестная категория"]},
    {"categories": ["Ведущий", "Ведущий"]}, {"event_formats": []},
    {"event_formats": ["неизвестный"]}, {"event_formats": ["корпоратив", "корпоратив"]},
    {"languages": []}, {"languages": ["неизвестный"]}, {"languages": ["русский", "русский"]},
    {"contact_email": "invalid"}, {"contact_email": "a @example.com"},
    {"contact_email": "a" * 244 + "@example.com"}, {"busy_dates": ["2026-11-14", "2026-11-14"]},
    {"busy_dates": ["2026-11-14T00:00:00"]}, {"busy_dates": [1794614400]},
    {"busy_dates": ["2027-01-01"]}, {"busy_dates": ["2026-09-22"]},
    {"busy_dates": ["2026-02-30"]}, {"busy_dates": ["2026-11-14"] * 101},
    {"status": "approved"}, {"source": "dataset"}, {"id": "hacked"},
    {"price_imputed": False}, {"city_imputed": False}, {"password": "must-never-be-accepted"},
    {"synthetic": "false"}, {"synthetic": 1},
]


@pytest.mark.parametrize("changes", BAD_APPLICATIONS)
def test_application_validation_rejects_invalid_values(api, changes):
    result = api.post("/api/applications", json=profile(**changes))
    assert result.status_code == 422, (changes, result.text)
    assert isinstance(result.json()["detail"], list)


def test_admin_creation_uses_same_validation(api):
    for changes in [{"price_from_kzt": True}, {"categories": []}, {"password": "wrong"},
                    {"busy_dates": ["2027-01-01"]}, {"contact_email": "invalid"}]:
        response = api.post("/api/admin/profiles", headers=AUTH, json=profile(**changes))
        assert response.status_code == 422, (changes, response.text)


def test_application_boundaries_and_trimming(api, created):
    body = profile(name="  QA  ", description="x" * 30, price_from_kzt=1000000000,
                   max_hours=24, busy_dates=["2026-09-23", "2026-12-31"])
    pending = post_profile(api, created, body)
    item = lookup(api, pending["id"])
    assert item["name"] == "QA" and item["max_hours"] == 24
    assert set(item["busy_dates"]) == {"2026-09-23", "2026-12-31"}
    item = post_profile(api, created, profile(max_hours=None), admin=True)
    assert item["status"] == "approved" and item["max_hours"] is None and item["source"] == "admin"


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"status": "deleted"}])
def test_admin_list_validates_pagination_and_filter(api, params):
    assert api.get("/api/admin/profiles", headers=AUTH, params=params).status_code == 422


def test_admin_pagination_counts_and_filter(api, created):
    pending = post_profile(api, created)
    listing = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 100}).json()
    assert listing["storage"] == "sqlite"
    assert listing["counts"]["pending"] >= 1
    assert listing["counts"]["approved"] >= 66
    first = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 2, "offset": 0}).json()
    second = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 2, "offset": 2}).json()
    assert len(first["items"]) == len(second["items"]) == 2
    assert {x["id"] for x in first["items"]}.isdisjoint(x["id"] for x in second["items"])
    filtered = api.get("/api/admin/profiles", headers=AUTH, params={"status": "pending"}).json()
    assert pending["id"] in [item["id"] for item in filtered["items"]]
    assert all(item["status"] == "pending" for item in filtered["items"])
    for item in listing["items"]:
        assert "password" not in item and "api_key" not in item and "token" not in item


def test_revision_conflicts_and_parallel_moderation(api, created):
    pending = post_profile(api, created)
    item = lookup(api, pending["id"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        calls = [pool.submit(moderate, api, item, decision) for decision in ("approved", "rejected")]
        responses = [future.result() for future in calls]
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = lookup(api, pending["id"])
    assert current["revision"] == item["revision"] + 1
    assert moderate(api, current, current["status"]).status_code == 409
    deletion = api.delete(f"/api/admin/profiles/{item['id']}", headers=AUTH,
                          params={"expected_revision": item["revision"]})
    assert deletion.status_code == 409
    assert lookup(api, pending["id"])["revision"] == current["revision"]


@pytest.mark.parametrize("patch", [{"decision": "pending"}, {"expected_revision": True},
                                    {"expected_revision": "1"}, {"expected_revision": 0},
                                    {"decision": "rejected", "note": " "}, {"note": "x" * 501},
                                    {"status": "approved"}])
def test_moderation_validation(api, created, patch):
    pending = post_profile(api, created)
    response = api.post(f"/api/admin/profiles/{pending['id']}/moderate", headers=AUTH,
                        json={"decision": "approved", "expected_revision": 1, "note": "", **patch})
    assert response.status_code == 422, response.text


def test_sql_persists_approved_rejected_and_deleted_seed_across_restart(tmp_path):
    database = tmp_path / "persistent.sqlite3"
    with isolated_server(database) as api:
        a = api.post("/api/admin/profiles", headers=AUTH, json=profile()).json()
        b = api.post("/api/applications", json=profile()).json()
        assert moderate(api, lookup(api, b["id"]), "rejected").status_code == 200
        seed = lookup(api, "HK-44923")
        assert api.delete("/api/admin/profiles/HK-44923", headers=AUTH,
                          params={"expected_revision": seed["revision"]}).status_code == 204
        version = api.get("/api/health").json()["dataset_version"]
    assert database.read_bytes().startswith(b"SQLite format 3\0")
    with isolated_server(database) as api:
        assert lookup(api, a["id"])["status"] == "approved"
        assert lookup(api, b["id"])["status"] == "rejected"
        listing = api.get("/api/admin/profiles", headers=AUTH, params={"limit": 100}).json()
        assert "HK-44923" not in [item["id"] for item in listing["items"]]
        assert api.get("/api/health").json()["dataset_version"] == version
        assert a["id"] in ids(recommend(api)) and b["id"] not in ids(recommend(api))
    with sqlite3.connect(database) as sql:
        assert sql.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert sql.execute("PRAGMA foreign_key_check").fetchall() == []
        for table in ("profile_categories", "profile_formats", "profile_languages", "profile_busy_dates"):
            assert sql.execute(f"SELECT COUNT(*) FROM {table} WHERE profile_id=?", ("HK-44923",)).fetchone() == (0,)
        audit = sql.execute("SELECT * FROM audit_log").fetchall()
        assert not any("@" in str(row) or TOKEN in str(row) for row in audit)


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


def test_sql_injection_like_text_is_stored_as_data(api, created):
    body = profile(name="QA'); DROP TABLE profiles; --", description="<script>alert('x')</script> " + "Тестовая программа " * 3)
    item = post_profile(api, created, body, admin=True)
    assert item["name"] == body["name"] and item["description"] == body["description"].strip()
    assert api.get("/api/admin/profiles", headers=AUTH).status_code == 200
    assert api.get("/api/options").json()["dataset"]["profiles_count"] >= 67
