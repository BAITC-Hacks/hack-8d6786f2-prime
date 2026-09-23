import os
import secrets
import time
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query as QueryParam, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .catalog import CALENDAR_MAX, CALENDAR_MIN, Catalog
from .explainer import Explainer, Settings, compose, excerpts, fallback_choice
from .http_limits import BodyLimitMiddleware
from .models import Alternative, Card, Health, Meta, Options, Query, Recommendation
from .profiles import AdminListing, AdminProfile, ApplicationReceipt, ModerationInput, ProfileInput
from .recommender import alternatives, nearby_candidates, select
from .storage import Store, StoreConflict, StoreMissing

ROOT = Path(__file__).resolve().parents[1]


def create_app(csv_path: Path | None = None, settings: Settings | None = None,
               db_path: Path | None = None, admin_token: str | None = None) -> FastAPI:
    load_dotenv(ROOT / "backend" / ".env", override=False)
    seed = Catalog(csv_path or Path(os.getenv("CONTRACTORS_CSV") or ROOT / "data" / "contractors.csv"))
    store = Store(db_path or Path(os.getenv("DATABASE_PATH") or ROOT / "data" / "catalog.sqlite3"), seed)
    explainer = Explainer(settings or Settings.from_env())
    token = os.getenv("ADMIN_API_TOKEN", "").strip() if admin_token is None else admin_token
    if token and len(token) < 32:
        raise ValueError("ADMIN_API_TOKEN must contain at least 32 characters")
    app = FastAPI(title="Подбор подрядчиков", version="2.0.0")
    app.state.catalog = store.snapshot()
    app.state.store = store
    app.state.explainer = explainer
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "Authorization"])
    app.add_middleware(BodyLimitMiddleware)

    @app.middleware("http")
    async def no_cached_profiles(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        # Do not reflect private form fields or non-finite numbers in validation responses.
        return JSONResponse({"detail": [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                                        for error in exc.errors()]}, status_code=422)

    @app.exception_handler(StoreConflict)
    async def conflict(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(StoreMissing)
    async def missing(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    def administrator(authorization: Annotated[str | None, Header()] = None):
        if not token:
            raise HTTPException(503, detail="Доступ администратора пока не настроен.")
        supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
        if not supplied or len(supplied) > 512 or not secrets.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(401, detail="Неверный код доступа администратора.", headers={"WWW-Authenticate": "Bearer"})

    def validate_profile(profile):
        vocabulary = store.vocabulary()
        errors = []
        for field, kind in (("city", "cities"), ("categories", "categories"),
                            ("event_formats", "event_types"), ("languages", "languages")):
            values = [profile.city] if field == "city" else getattr(profile, field)
            if any(value not in vocabulary[kind] for value in values):
                errors.append({"loc": ["body", field], "msg": "Выберите значения из справочника", "type": "value_error"})
        if errors:
            raise HTTPException(422, detail=errors)

    @app.post("/api/applications", response_model=ApplicationReceipt, status_code=201)
    def apply(profile: ProfileInput):
        validate_profile(profile)
        item = store.create(profile)
        return ApplicationReceipt(id=item["id"])

    @app.get("/api/admin/profiles", response_model=AdminListing, dependencies=[Depends(administrator)])
    def admin_profiles(status: Literal["all", "pending", "approved", "rejected"] = "all",
                       limit: int = QueryParam(50, ge=1, le=100), offset: int = QueryParam(0, ge=0)):
        return store.list_profiles(status, limit, offset)

    @app.post("/api/admin/profiles", response_model=AdminProfile, status_code=201, dependencies=[Depends(administrator)])
    def admin_create(profile: ProfileInput):
        validate_profile(profile)
        return store.create(profile, admin=True)

    @app.post("/api/admin/profiles/{profile_id}/moderate", response_model=AdminProfile, dependencies=[Depends(administrator)])
    def moderate(profile_id: str, decision: ModerationInput):
        return store.moderate(profile_id, decision.decision, decision.expected_revision, decision.note)

    @app.delete("/api/admin/profiles/{profile_id}", status_code=204, dependencies=[Depends(administrator)])
    def delete(profile_id: str, expected_revision: int = QueryParam(..., ge=1)):
        store.delete(profile_id, expected_revision)
        return Response(status_code=204)

    @app.get("/api/health", response_model=Health)
    def health():
        return {"status": "ok", "dataset_version": store.snapshot().version,
                "ai_available": explainer.settings.available}

    @app.get("/api/options", response_model=Options)
    def options():
        return store.snapshot().options()

    @app.post("/api/recommend", response_model=Recommendation)
    async def recommend(query: Query):
        started = time.perf_counter()
        catalog = store.snapshot()
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
        # A moderation change during an LLM request must not publish a removed profile.
        latest = store.snapshot()
        if latest.version != catalog.version:
            catalog = latest
            selection = select(catalog, query)
            top = selection.eligible[:3]
            explanations, mode = await Explainer(Settings()).explain(top, query, catalog.version)
        cards = [make_card(row, query, explanations[row.id]) for row in top]
        near = []
        for row, proposed, changes, differences in nearby_candidates(query, selection):
            snippets = excerpts(row.description)
            grounded = compose(row, proposed, fallback_choice(row, proposed, snippets), snippets)
            near.append(Alternative(card=make_card(row, proposed, grounded), changes=changes, differences=differences))
        return Recommendation(status=selection.status, query=query,
                              total_in_category=len(selection.base), eligible_count=len(selection.eligible),
                              cards=cards, summary=selection.summary, rejections=selection.rejections,
                              suggestions=alternatives(catalog, query, selection),
                              alternatives=near,
                              meta=Meta(dataset_version=catalog.version, explanation_mode=mode,
                                        latency_ms=round((time.perf_counter() - started) * 1000)))

    return app


def make_card(row, query, explanation):
    return Card(id=row.id, name=row.name, categories=list(row.categories), city=row.city,
                price_from_kzt=row.price_from_kzt, languages=list(row.languages), max_hours=row.max_hours,
                available_on=query.date, description=row.description,
                explanation=explanation[0], evidence=explanation[1],
                synthetic=row.synthetic, price_imputed=row.price_imputed, city_imputed=row.city_imputed)


app = create_app()
