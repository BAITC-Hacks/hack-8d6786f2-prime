"""Reproducible evaluation of 28 fixed queries. Default: no paid API calls."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.application import create_app
from backend.evidence import fact_signals, FORMAT_STEMS
from backend.explainer import Settings
from backend.runtime import RuntimePaths

SUITE = json.loads((ROOT / "qa/evaluation-cases.json").read_text(encoding="utf-8"))
DANGLING = re.compile(r"\b(?:этот|эту|чтобы|который|которая|что|для|при|на|и|или|с|в|к|а)$", re.I)


def quality(cards, query):
    rows = []
    for card in cards:
        quote = next(row["value"] for row in card["evidence"] if row["field"] == "description")
        rows.append({"id": card["id"], "quote": quote, "explanation": card["explanation"],
                     "signals": sorted(fact_signals(quote)),
                     "grounded": bool(quote) and quote in card["description"] and quote in card["explanation"],
                     "complete_signal": bool(quote) and not DANGLING.search(quote.strip(" .!?…»\"")),
                     "event_mentioned": any(stem in quote.casefold() for stem in FORMAT_STEMS.get(query["event_type"], ())),
                     "limitation_reported": any(row["field"] == "description_limitation" for row in card["evidence"])})
    for row in rows:
        other = set().union(*(set(peer["signals"]) for peer in rows if peer["id"] != row["id"]))
        row["distinct_fact_signal"] = bool(set(row["signals"]) - other)
    return rows


def percentile(values, p):
    values = sorted(values)
    return round(values[max(0, math.ceil(len(values) * p) - 1)], 2) if values else None


def evaluate(settings):
    records = []
    with tempfile.TemporaryDirectory() as directory:
        app = create_app(db_path=Path(directory) / "catalog.sqlite3", settings=settings)
        with TestClient(app) as client:
            assert client.get("/api/health").json()["dataset_version"] == SUITE["dataset_version"]
            for case in SUITE["cases"]:
                # Every 'fresh' measurement starts without a cached result, even for duplicate queries.
                app.state.explainer.cache.clear()
                started = time.perf_counter()
                response = client.post("/api/recommend", json=case["query"])
                elapsed = (time.perf_counter() - started) * 1000
                assert response.status_code == 200, case["id"]
                result = response.json()
                assert {"status": result["status"], "cards": [row["id"] for row in result["cards"]]} == case["expected"], case["id"]
                checked = quality(result["cards"], case["query"])
                assert all(row["grounded"] and row["complete_signal"] for row in checked), case["id"]
                if case["query"]["category"] == "Лайв-бэнд" and result["cards"]:
                    by_id = {row["id"]: row for row in checked}
                    assert "два вокалиста" in by_id["HK-23752"]["quote"]
                    assert "струнный квартет" in by_id["HK-83709"]["quote"]
                started = time.perf_counter()
                repeated = client.post("/api/recommend", json=case["query"]).json()
                repeat_ms = (time.perf_counter() - started) * 1000
                assert repeated["cards"] == result["cards"]
                records.append({"id": case["id"], "status": result["status"], "mode": result["meta"]["explanation_mode"],
                                "fresh_ms": round(elapsed, 2), "repeat_ms": round(repeat_ms, 2),
                                "repeat_cache_hit": repeated["meta"]["ai"]["cache_hit"],
                                "ai": result["meta"]["ai"], "cards": checked})
    cards = [card for row in records for card in row["cards"]]
    return {"provider": settings.provider if settings.available else "disabled", "model": settings.model if settings.available else None,
            "cases": records, "summary": {"queries": len(records), "cards": len(cards),
                "llm_queries": sum(row["mode"] == "llm" for row in records),
                **{signal: sum(bool(row[signal]) for row in cards) for signal in
                   ("grounded", "complete_signal", "distinct_fact_signal", "event_mentioned", "limitation_reported")},
                "fresh_p95_ms": percentile([row["fresh_ms"] for row in records if row["cards"]], .95),
                "cache_p95_ms": percentile([row["repeat_ms"] for row in records if row["repeat_cache_hit"]], .95),
                "fallback_p95_ms": percentile([row["fresh_ms"] for row in records if row["mode"] == "fallback"], .95)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Also evaluate the configured real provider (up to 24 paid requests)")
    parser.add_argument("--output", type=Path, default=ROOT / "qa/artifacts/evaluation.json")
    args = parser.parse_args()
    report = {"evaluated_at": datetime.now(timezone.utc).isoformat(), "dataset_version": SUITE["dataset_version"],
              "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "working_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
              "environment": {"python": platform.python_version(), "os": platform.platform()},
              "scope": "Local complete HTTP path via TestClient, not internet latency or a semantic proof",
              "fallback": evaluate(Settings())}
    if args.live:
        RuntimePaths.discover().load_environment()
        settings = Settings.from_env()
        if not settings.available:
            raise SystemExit("Configure your own API key before using --live; key values are never printed")
        report["live"] = evaluate(settings)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({mode: report[mode]["summary"] for mode in ("fallback", "live") if mode in report}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
