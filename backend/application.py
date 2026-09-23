"""Application factory: configuration, middleware, API and the built web interface."""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import create_api_router
from .explainer import Explainer, Settings
from .http_limits import BodyLimitMiddleware
from .recommendations import InvalidQuery
from .runtime import RuntimePaths
from .storage import Store


def create_app(csv_path: Path | None = None, settings: Settings | None = None,
               db_path: Path | None = None,
               frontend_dir: Path | None = None) -> FastAPI:
    paths = RuntimePaths.discover()
    paths.load_environment()
    store = Store(db_path or paths.database, csv_path or paths.seed)
    explainer = Explainer(settings or Settings.from_env())
    app = FastAPI(title="Подбор подрядчиков", version="3.0.0")
    app.state.catalog = store.snapshot()
    app.state.store = store
    app.state.explainer = explainer
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.add_middleware(BodyLimitMiddleware)

    @app.middleware("http")
    async def no_cached_profiles(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        return JSONResponse({"detail": [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                                        for error in exc.errors()]}, status_code=422)

    @app.exception_handler(InvalidQuery)
    async def invalid_query(request, exc):
        return JSONResponse({"detail": exc.errors}, status_code=422)

    app.include_router(create_api_router(store, explainer))
    web = Path(frontend_dir) if frontend_dir is not None else paths.frontend
    if (web / "index.html").is_file():
        # Mount only the built public assets, never the repository or local data directory.
        app.mount("/", StaticFiles(directory=web, html=True), name="frontend")
    elif frontend_dir is not None or os.getenv("SAT_FRONTEND_DIR"):
        raise ValueError("Frontend build is missing index.html")
    return app
