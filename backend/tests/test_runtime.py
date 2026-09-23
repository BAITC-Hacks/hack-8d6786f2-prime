"""Single-server delivery must not expose source files or mix data with shipped assets."""
import os
from pathlib import Path
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from backend.application import create_app
from backend.explainer import Settings
from backend.launcher import initialize_config
from backend.runtime import RuntimePaths


def test_site_and_api_share_one_app_without_exposing_private_files(tmp_path):
    public = tmp_path / "dist"
    public.mkdir()
    (public / "index.html").write_text('<html><script src="/assets/app.js"></script></html>', encoding="utf-8")
    (public / "assets").mkdir()
    (public / "assets/app.js").write_text("console.log('public asset')", encoding="utf-8")
    (tmp_path / ".env").write_text("PRIVATE_VALUE=must-not-be-served", encoding="utf-8")
    app = create_app(settings=Settings(api_key=""), db_path=tmp_path / "catalog.sqlite3",
                     admin_token="", frontend_dir=public)
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert "public asset" in client.get("/assets/app.js").text
        assert client.get("/api/options").json()["dataset"]["profiles_count"] == 66
        assert client.post("/api/recommend", json={}).status_code == 422
        assert client.get("/api/admin/profiles").status_code == 503
        for path in ("/.env", "/catalog.sqlite3", "/backend/app.py", "/data/contractors.csv",
                     "/%2e%2e/.env", "/api/missing"):
            response = client.get(path)
            assert response.status_code == 404
            assert "must-not-be-served" not in response.text
            assert "text/html" not in response.headers.get("content-type", "")


def test_application_factory_import_does_not_create_sql_or_configuration(tmp_path):
    env = dict(os.environ, SAT_DATA_DIR=str(tmp_path), DATABASE_PATH=str(tmp_path / "unused.sqlite3"))
    result = subprocess.run([sys.executable, "-c", "import backend.application"], env=env,
                            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=15)
    assert result.returncode == 0
    assert not list(tmp_path.iterdir())


def test_bundled_database_survives_resource_location_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("SAT_DATA_DIR", raising=False)
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    paths = RuntimePaths.discover()
    assert paths.state == tmp_path / "SatContractors"
    assert paths.database == paths.state / "catalog.sqlite3"
    assert paths.env_file == paths.state / ".env"
    assert paths.seed.is_file()
    assert paths.resources != paths.state


def test_explicit_state_and_relative_config_paths_do_not_depend_on_working_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("SAT_DATA_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("DATABASE_PATH", "data/another.sqlite3")
    monkeypatch.chdir(tmp_path)
    paths = RuntimePaths.discover()
    assert paths.env_file == tmp_path / "state/.env"
    assert paths.database == paths.resources / "data/another.sqlite3"


def test_first_launch_configuration_is_unique_and_never_overwritten(tmp_path):
    paths = RuntimePaths(tmp_path, tmp_path, tmp_path / ".env", True)
    initialize_config(paths)
    original = paths.env_file.read_text(encoding="utf-8")
    assert "OPENAI_API_KEY=\n" in original
    token = next(line.split("=", 1)[1] for line in original.splitlines() if line.startswith("ADMIN_API_TOKEN="))
    assert len(token) >= 32
    paths.env_file.write_text(original + "# local customization\n", encoding="utf-8")
    initialize_config(paths)
    assert paths.env_file.read_text(encoding="utf-8") == original + "# local customization\n"


def test_explicit_missing_frontend_build_is_a_startup_error(tmp_path):
    with pytest.raises(ValueError, match="Frontend build"):
        create_app(settings=Settings(api_key=""), db_path=tmp_path / "catalog.sqlite3",
                   admin_token="", frontend_dir=tmp_path / "absent")
