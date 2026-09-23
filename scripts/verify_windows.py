"""Verify the distributed ZIP, isolated from source/runtime; optional real browser checks."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile

import httpx

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def running(executable, state, *, missing_seed=False):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {key: value for key, value in os.environ.items()
           if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "COMSPEC"}}
    env.update(PATH=str(Path(os.environ["SYSTEMROOT"]) / "System32"), OPENAI_API_KEY="", NVIDIA_API_KEY="",
               LLM_PROVIDER="openai")
    if missing_seed:
        env["CONTRACTORS_CSV"] = str(state / "unavailable.csv")
    with (state.parent / "server.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen([str(executable), "--no-browser", "--port", str(port), "--data-dir", str(state)],
                                   cwd=state.parent, env=env, stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10) as client:
                for _ in range(150):
                    if process.poll() is not None:
                        raise RuntimeError("Packaged app stopped during startup; see the isolated server.log")
                    try:
                        if client.get("/api/health").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(.1)
                else:
                    raise RuntimeError("Packaged application did not become ready")
                yield client
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("This verifier runs the Windows executable.")
    with tempfile.TemporaryDirectory(prefix="sat-verify-", dir=args.archive.resolve().parent) as temporary:
        temporary = Path(temporary)
        extracted = temporary / "проверка архива"
        extracted.mkdir()
        with zipfile.ZipFile(args.archive) as archive:
            for member in archive.infolist():
                target = (extracted / member.filename).resolve()
                if not target.is_relative_to(extracted.resolve()):
                    raise RuntimeError("Archive member escapes the extraction directory")
                if target.name == ".env" or target.name.endswith((".sqlite3", "-wal", "-shm")):
                    raise RuntimeError("Archive contains local private state")
            archive.extractall(extracted)
        executable = extracted / "SatContractors/Start.exe"
        state = temporary / "separate-state"
        with running(executable, state) as client:
            assert client.get("/").status_code == 200
            assert client.get("/api/options").json()["dataset"]["profiles_count"] == 66
            assert client.get("/api/health").json()["ai_available"] is False
            recommendation = client.post("/api/recommend", json={
                "city": "Алматы", "date": "2026-11-14", "event_type": "той",
                "category": "Национальный ансамбль", "budget_kzt": 400000,
                "duration_hours": 2, "language": "казахский"})
            assert recommendation.status_code == 200
            result = recommendation.json()
            assert result["meta"]["explanation_mode"] == "fallback"
            ensemble = next(card for card in result["cards"] if card["id"] == "HK-19103")
            assert "энергичная команда джигитов" in ensemble["explanation"]
            assert "свяжитесь с нами" not in ensemble["explanation"]
            assert ensemble["evidence"][0]["value"] in ensemble["description"]
            for path in ("/.env", "/data/catalog.sqlite3", "/backend/app.py"):
                assert client.get(path).status_code == 404
            assert client.get("/api/admin/profiles").status_code == 404
            assert client.post("/api/applications", json={}).status_code in {404, 405}
            version = client.get("/api/health").json()["dataset_version"]
            if args.browser:
                node = shutil.which("node")
                if not node:
                    raise RuntimeError("Node.js is required only for the browser test runner")
                browser_env = dict(os.environ, QA_FRONTEND_URL=str(client.base_url).rstrip("/"),
                                   RUN_BACKEND_TESTS="1")
                result = subprocess.run([node, "node_modules/@playwright/test/cli.js", "test",
                                         "tests/backend.spec.ts", "tests/alternatives.spec.ts"],
                                        cwd=ROOT / "frontend", env=browser_env, capture_output=True,
                                        encoding="utf-8", errors="replace")
                print(result.stdout)
                if result.returncode:
                    raise RuntimeError("Packaged app browser checks failed")
        with running(executable, state, missing_seed=True) as client:
            assert client.get("/api/health").json()["dataset_version"] == version
            assert client.get("/api/options").json()["dataset"]["profiles_count"] == 66
        print(json.dumps({"package": "passed", "restart_without_csv": "passed", "fallback_evidence": "passed",
                          "external_python_node_on_app_path": False, "browser": args.browser}))


if __name__ == "__main__":
    main()
