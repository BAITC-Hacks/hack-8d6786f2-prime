"""HTTP routes, authentication and input validation; no application creation."""
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query as QueryParam, Response

from .models import Health, Options, Query, Recommendation
from .profiles import AdminListing, AdminProfile, ApplicationReceipt, ModerationInput, ProfileInput
from .recommendations import recommend


def create_api_router(store, explainer, token):
    router = APIRouter(prefix="/api")
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

    @router.post("/applications", response_model=ApplicationReceipt, status_code=201)
    def apply(profile: ProfileInput):
        validate_profile(profile)
        item = store.create(profile)
        return ApplicationReceipt(id=item["id"])

    @router.get("/admin/profiles", response_model=AdminListing, dependencies=[Depends(administrator)])
    def admin_profiles(status: Literal["all", "pending", "approved", "rejected"] = "all",
                       limit: int = QueryParam(50, ge=1, le=100), offset: int = QueryParam(0, ge=0)):
        return store.list_profiles(status, limit, offset)

    @router.post("/admin/profiles", response_model=AdminProfile, status_code=201, dependencies=[Depends(administrator)])
    def admin_create(profile: ProfileInput):
        validate_profile(profile)
        return store.create(profile, admin=True)

    @router.post("/admin/profiles/{profile_id}/moderate", response_model=AdminProfile, dependencies=[Depends(administrator)])
    def moderate(profile_id: str, decision: ModerationInput):
        return store.moderate(profile_id, decision.decision, decision.expected_revision, decision.note)

    @router.delete("/admin/profiles/{profile_id}", status_code=204, dependencies=[Depends(administrator)])
    def delete(profile_id: str, expected_revision: int = QueryParam(..., ge=1)):
        store.delete(profile_id, expected_revision)
        return Response(status_code=204)

    @router.get("/health", response_model=Health)
    def health():
        return {"status": "ok", "dataset_version": store.snapshot().version,
                "ai_available": explainer.settings.available}

    @router.get("/options", response_model=Options)
    def options():
        return store.snapshot().options()

    @router.post("/recommend", response_model=Recommendation)
    async def recommendations(query: Query):
        return await recommend(store, explainer, query)

    return router
