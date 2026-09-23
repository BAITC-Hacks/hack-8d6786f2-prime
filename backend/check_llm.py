"""One live model request with the real catalogue; no secret values are printed."""
import asyncio
import json
import time

from .explainer import Explainer, Settings
from .models import Query
from .recommender import select
from .storage import Store
from .runtime import RuntimePaths


async def check() -> int:
    paths = RuntimePaths.discover()
    paths.load_environment()
    settings = Settings.from_env()
    if not settings.available:
        print(json.dumps({"ok": False, "provider": settings.provider,
                          "message": "Заполните ключ и модель в backend/.env. Значения ключей не выводятся."}, ensure_ascii=False))
        return 2
    catalog = Store(paths.database, paths.seed).snapshot()
    query = Query(city="Алматы", date="2026-11-14", event_type="корпоратив", category="Ведущий",
                  budget_kzt=1500000, duration_hours=6, language="русский")
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
