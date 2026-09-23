"""The import source is needed only until the first successful SQL transaction."""
from pathlib import Path
import shutil

import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.explainer import Settings
from backend.storage import Store

SOURCE = Path(__file__).resolve().parents[2] / "data" / "contractors.csv"


def test_initialized_database_survives_missing_csv(tmp_path):
    seed = tmp_path / "import.csv"
    shutil.copyfile(SOURCE, seed)
    database = tmp_path / "catalog.sqlite3"
    app = create_app(csv_path=seed, db_path=database, settings=Settings(api_key=""))
    store = app.state.store
    expected_records = store.snapshot().records
    expected_version = store.snapshot().version
    seed.unlink()

    restarted = create_app(csv_path=seed, db_path=database, settings=Settings(api_key=""))
    with TestClient(restarted) as client:
        assert client.get("/api/health").json()["dataset_version"] == expected_version
        assert client.get("/api/options").json()["dataset"]["profiles_count"] == 66
    assert restarted.state.store.snapshot().records == expected_records


def test_sql_snapshot_preserves_every_source_record_and_flag(tmp_path):
    from backend.catalog import Catalog
    source = Catalog(SOURCE)
    saved = Store(tmp_path / "catalog.sqlite3", SOURCE).snapshot()
    assert saved.version == Store(tmp_path / "catalog.sqlite3", SOURCE).snapshot().version
    expected = {row.id: row for row in source.records}
    assert {row.id for row in saved.records} == set(expected)
    relations = {"categories", "event_formats", "languages"}
    for row in saved.records:
        original = expected[row.id]
        assert {k: v for k, v in vars(row).items() if k not in relations} == {
            k: v for k, v in vars(original).items() if k not in relations
        }
        for field in relations:
            assert set(getattr(row, field)) == set(getattr(original, field))


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
