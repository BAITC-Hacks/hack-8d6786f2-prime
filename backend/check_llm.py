"""One live model request with the real catalogue; no secret values are printed."""
import asyncio
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from .explainer import Explainer, Settings
from .models import Query
from .recommender import select
from .storage import Store


async def check() -> int:
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / "backend" / ".env", override=False)
    settings = Settings.from_env()
    if not settings.available:
        print(json.dumps({"ok": False, "provider": settings.provider,
                          "message": "Заполните ключ и модель в backend/.env. Значения ключей не выводятся."}, ensure_ascii=False))
        return 2
    seed = Path(os.getenv("CONTRACTORS_CSV") or root / "data" / "contractors.csv")
    catalog = Store(Path(os.getenv("DATABASE_PATH") or root / "data" / "catalog.sqlite3"), seed).snapshot()
    query = Query(city="Алматы", date="2026-11-14", event_type="корпоратив", category="Ведущий",
                  budget_kzt=1500000, duration_hours=6, language="русский", preferences="интеллигентный юмор")
    selected = select(catalog, query).eligible[:3]
    started = time.perf_counter()
    explanations, mode = await Explainer(settings).explain(selected, query, catalog.version)
    print(json.dumps({"ok": mode == "llm", "provider": settings.provider,
                      "explanation_mode": mode, "latency_ms": round((time.perf_counter() - started) * 1000),
                      "cards": [{"id": row.id, "explanation": explanations[row.id][0]} for row in selected]}, ensure_ascii=False, indent=2))
    return 0 if mode == "llm" else 1


if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(asyncio.run(check()))
