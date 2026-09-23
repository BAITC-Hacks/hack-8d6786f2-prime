"""Launch isolated API + Vite, run browser recommendation acceptance, then clean up."""

from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx

from test_recommendation_http import isolated_server, stop_process, ROOT


@contextmanager
def frontend(backend_url, temporary, node):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ, BACKEND_URL=backend_url, VITE_MOCK_MODE="false")
    with (temporary / "vite.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [node, "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
            cwd=ROOT / "frontend", env=env, stdout=log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            url = f"http://127.0.0.1:{port}"
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError((temporary / "vite.log").read_text(encoding="utf-8"))
                try:
                    response = httpx.get(url + "/api/health", timeout=1)
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(.1)
            else:
                raise RuntimeError("Isolated frontend did not become ready")
            yield url
        finally:
            stop_process(process)


def main():
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js is required on PATH")
    # Playwright clears its output directory; do not erase evaluation/load reports.
    output = ROOT / "qa" / "artifacts" / "browser"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="recommendation-e2e-") as directory:
        temporary = Path(directory)
        with isolated_server(temporary / "catalog.sqlite3") as api:
            with frontend(str(api.base_url).rstrip("/"), temporary, node) as url:
                env = dict(os.environ, QA_DATABASE_ISOLATED="1", QA_FRONTEND_URL=url,
                           RUN_BACKEND_TESTS="1", QA_BROWSER_OUTPUT=str(output))
                result = subprocess.run(
                    [node, str(ROOT / "frontend/node_modules/@playwright/test/cli.js"), "test",
                     "--config", str(ROOT / "qa/playwright.config.cjs"), *sys.argv[1:]],
                    cwd=ROOT / "frontend", env=env,
                )
                return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
