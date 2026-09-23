"""Measure real localhost HTTP fallback latency against a fresh isolated process."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform
import subprocess
import tempfile
import time

import httpx
from test_recommendation_http import isolated_server, QUERY, ROOT


async def measure(url, requests, concurrency):
    limiter = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(base_url=url, timeout=15, limits=httpx.Limits(max_connections=concurrency)) as client:
        async def send(index):
            async with limiter:
                started = time.perf_counter()
                response = await client.post("/api/recommend", json={**QUERY, "date": "2026-11-15" if index % 2 else "2026-11-14"})
                assert response.status_code == 200
                assert response.json()["meta"]["explanation_mode"] == "fallback"
                assert len(response.json()["cards"]) == 3
                return (time.perf_counter() - started) * 1000
        samples = sorted(await asyncio.gather(*(send(i) for i in range(requests))))
    return {"requests": requests, "concurrency": concurrency, "errors": 0,
            "p50_ms": round(samples[math.ceil(len(samples)*.5)-1], 2),
            "p95_ms": round(samples[math.ceil(len(samples)*.95)-1], 2), "max_ms": round(max(samples), 2)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--output", type=Path, default=ROOT / "qa/artifacts/load.json")
    args = parser.parse_args()
    if not 1 <= args.concurrency <= args.requests <= 1000:
        parser.error("Require 1 <= concurrency <= requests <= 1000")
    with tempfile.TemporaryDirectory() as folder:
        with isolated_server(Path(folder) / "catalog.sqlite3") as client:
            result = asyncio.run(measure(str(client.base_url), args.requests, args.concurrency))
            result["dataset_version"] = client.get("/api/health").json()["dataset_version"]
    result.update(evaluated_at=datetime.now(timezone.utc).isoformat(), environment=platform.platform(),
                  commit=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                  mode="fallback; real localhost HTTP; excludes waiting for the load generator semaphore")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
