import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .catalog import CALENDAR_MAX, CALENDAR_MIN, Catalog
from .explainer import Explainer, Settings
from .models import Card, Meta, Query, Recommendation
from .recommender import alternatives, select

ROOT = Path(__file__).resolve().parents[1]


def create_app(csv_path: Path | None = None, settings: Settings | None = None) -> FastAPI:
    load_dotenv(ROOT / "backend" / ".env", override=False)
    catalog = Catalog(csv_path or Path(os.getenv("CONTRACTORS_CSV") or ROOT / "data" / "contractors.csv"))
    explainer = Explainer(settings or Settings.from_env())
    app = FastAPI(title="Подбор подрядчиков", version="1.0.0")
    app.state.catalog = catalog
    app.state.explainer = explainer
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.get("/api/health")
    def health():
        return {"status": "ok", "dataset_version": catalog.version,
                "ai_available": explainer.settings.available}

    @app.get("/api/options")
    def options():
        return catalog.options()

    @app.post("/api/recommend", response_model=Recommendation)
    async def recommend(query: Query):
        started = time.perf_counter()
        errors = []
        if not CALENDAR_MIN <= query.date <= CALENDAR_MAX:
            errors.append({"loc": ["body", "date"], "msg": "Календарь доступен с 23.09.2026 по 31.12.2026", "type": "value_error"})
        for field, allowed in [("city", catalog.cities), ("category", catalog.categories),
                               ("event_type", catalog.event_types), ("language", catalog.languages)]:
            value = getattr(query, field)
            if value is not None and value not in allowed:
                errors.append({"loc": ["body", field], "msg": "Значение отсутствует в справочнике каталога", "type": "value_error"})
        if errors:
            raise HTTPException(422, detail=errors)
        selection = select(catalog, query)
        top = selection.eligible[:3]
        explanations, mode = await explainer.explain(top, query, catalog.version)
        cards = [Card(id=r.id, name=r.name, categories=list(r.categories), city=r.city,
                      price_from_kzt=r.price_from_kzt, languages=list(r.languages), max_hours=r.max_hours,
                      available_on=query.date, description=r.description,
                      explanation=explanations[r.id][0], evidence=explanations[r.id][1],
                      synthetic=r.synthetic, price_imputed=r.price_imputed, city_imputed=r.city_imputed)
                 for r in top]
        return Recommendation(status=selection.status, query=query,
                              total_in_category=len(selection.base), eligible_count=len(selection.eligible),
                              cards=cards, summary=selection.summary, rejections=selection.rejections,
                              suggestions=alternatives(catalog, query, selection),
                              meta=Meta(dataset_version=catalog.version, explanation_mode=mode,
                                        latency_ms=round((time.perf_counter() - started) * 1000)))

    return app


app = create_app()
