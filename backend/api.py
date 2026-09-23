"""Read-only recommendation API for the hackathon case."""
from fastapi import APIRouter

from .models import Health, Options, Query, RecommendationResponse
from .recommendations import recommend


def create_api_router(store, explainer):
    router = APIRouter(prefix="/api")

    @router.get("/health", response_model=Health)
    def health():
        return {"status": "ok", "dataset_version": store.snapshot().version,
                "ai_available": explainer.settings.available}

    @router.get("/options", response_model=Options)
    def options():
        return store.snapshot().options()

    @router.post("/recommend", response_model=RecommendationResponse)
    async def recommendations(query: Query):
        return await recommend(store, explainer, query)

    return router
