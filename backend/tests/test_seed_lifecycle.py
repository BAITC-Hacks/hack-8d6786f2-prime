"""The import source is needed only until the first successful SQL transaction."""
from pathlib import Path
import shutil

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.explainer import Settings
from backend.storage import Store
from backend.profiles import ProfileInput
from backend.tests.test_profile_rules import profile

SOURCE = Path(__file__).resolve().parents[2] / "data" / "contractors.csv"


def test_initialized_database_survives_missing_csv_without_losing_moderation(tmp_path):
    seed = tmp_path / "import.csv"
    shutil.copyfile(SOURCE, seed)
    database = tmp_path / "catalog.sqlite3"
    app = create_app(csv_path=seed, db_path=database, settings=Settings(api_key=""), admin_token="")
    store = app.state.store
    item = store.create(ProfileInput(**profile()))
    store.moderate(item["id"], "approved", 1, "Проверено")
    store.delete("HK-44923", 1)
    expected_version = store.snapshot().version
    seed.unlink()

    restarted = create_app(csv_path=seed, db_path=database, settings=Settings(api_key=""), admin_token="")
    with TestClient(restarted) as client:
        assert client.get("/api/health").json()["dataset_version"] == expected_version
        assert client.get("/api/options").json()["dataset"]["profiles_count"] == 66
    records = restarted.state.store.list_profiles(limit=100)["items"]
    assert all(row["id"] != "HK-44923" for row in records)
    saved = next(row for row in records if row["id"] == item["id"])
    assert saved["status"] == "approved" and saved["revision"] == 2
    assert saved["moderation_note"] == "Проверено"
    assert saved["contact_email"] == "backend-test@example.com"


def test_failed_first_import_can_be_retried_without_partial_seed(tmp_path):
    database = tmp_path / "catalog.sqlite3"
    with pytest.raises(FileNotFoundError):
        Store(database, tmp_path / "absent.csv")
    store = Store(database, SOURCE)
    assert len(store.snapshot().records) == 66
    with store.connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM metadata WHERE key='seed_version'").fetchone()[0] == 1
    # A changed or broken seed must not overwrite an already initialized database.
    broken = tmp_path / "broken.csv"
    broken.write_text("invalid,csv", encoding="utf-8")
    assert Store(database, broken).snapshot().version == store.snapshot().version
