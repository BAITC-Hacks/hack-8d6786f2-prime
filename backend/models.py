from datetime import date as Date
from typing import Annotated, Literal
from typing_extensions import TypedDict

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator, with_config


class Query(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    city: str = Field(min_length=1, max_length=80)
    date: Date
    event_type: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=80)
    budget_kzt: int = Field(gt=0, strict=True)
    duration_hours: float | None = Field(default=None, gt=0, allow_inf_nan=False, strict=True)
    language: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("date", mode="before")
    @classmethod
    def calendar_date_only(cls, value):
        if type(value) is Date or (isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)):
            return value
        raise ValueError("Дата должна быть строкой YYYY-MM-DD")


class Health(BaseModel):
    status: Literal["ok"]
    dataset_version: str
    ai_available: bool


class CalendarRange(BaseModel):
    min: Date
    max: Date


class DatasetInfo(BaseModel):
    version: str
    profiles_count: int


class Options(BaseModel):
    cities: list[str]
    categories: list[str]
    event_types: list[str]
    languages: list[str]
    calendar: CalendarRange
    dataset: DatasetInfo


class Evidence(BaseModel):
    field: str
    value: str


class Card(BaseModel):
    id: str
    name: str
    categories: list[str]
    city: str
    price_from_kzt: int
    languages: list[str]
    max_hours: float | None
    available_on: Date
    description: str
    explanation: str
    evidence: list[Evidence]
    synthetic: bool
    price_imputed: bool
    city_imputed: bool


class Rejections(BaseModel):
    busy: int = Field(default=0, ge=0)
    budget: int = Field(default=0, ge=0)
    event_type: int = Field(default=0, ge=0)
    language: int = Field(default=0, ge=0)
    duration: int = Field(default=0, ge=0)


class AIDiagnostics(BaseModel):
    cache_hit: bool = False
    shared_inflight: bool = False
    quality_repaired: bool = False
    fallback_reason: Literal["no_candidates", "not_configured", "circuit_open", "overloaded",
                              "rate_limit", "session_budget", "timeout", "provider_http",
                              "provider_network", "invalid_response"] | None = None
    elapsed_ms: int = Field(default=0, ge=0)


class Meta(BaseModel):
    dataset_version: str
    explanation_mode: Literal["llm", "fallback"]
    latency_ms: int = Field(ge=0)
    ai: AIDiagnostics = Field(default_factory=AIDiagnostics)


@with_config(ConfigDict(extra="forbid"))
class Changes(TypedDict, total=False):
    date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    budget_kzt: Annotated[int, Field(gt=0, strict=True)]
    language: Annotated[str, Field(min_length=1, max_length=80)] | None
    duration_hours: Annotated[float, Field(gt=0, allow_inf_nan=False, strict=True)] | None


class ChangedConditions(BaseModel):
    changes: Changes

    @field_validator("changes")
    @classmethod
    def actual_changes(cls, value):
        if not value:
            raise ValueError("At least one changed condition is required")
        if "date" in value:
            Date.fromisoformat(value["date"])
        return value


class Suggestion(ChangedConditions):
    label: str


class Difference(BaseModel):
    field: Literal["date", "budget_kzt", "language", "duration_hours"]
    requested: str
    proposed: str
    reason: str


class Alternative(ChangedConditions):
    card: Card
    differences: list[Difference] = Field(min_length=1, max_length=4)
    explanation_mode: Literal["fallback"] = "fallback"

    @model_validator(mode="after")
    def changes_are_explained(self):
        fields = [difference.field for difference in self.differences]
        if len(set(fields)) != len(fields) or set(fields) != set(self.changes):
            raise ValueError("Explain each change exactly once")
        return self


RejectionReason = Literal["busy", "budget", "event_type", "language", "duration"]


class Assessment(BaseModel):
    id: str
    name: str
    status: Literal["selected", "not_selected", "excluded"]
    reasons: list[RejectionReason]
    rank: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def eligibility(self):
        if self.status == "excluded":
            valid = bool(self.reasons) and self.rank is None
        else:
            valid = not self.reasons and self.rank is not None and ((self.rank <= 3) == (self.status == "selected"))
        if not valid or len(set(self.reasons)) != len(self.reasons):
            raise ValueError("Inconsistent candidate assessment")
        return self


class Recommendation(BaseModel):
    status: Literal["matched", "no_category", "no_match"]
    query: Query
    total_in_category: int = Field(ge=0)
    eligible_count: int = Field(ge=0)
    cards: list[Card] = Field(max_length=3)
    summary: str
    rejections: Rejections
    suggestions: list[Suggestion]
    meta: Meta
    alternatives: list[Alternative] = Field(default_factory=list, max_length=3)
    assessments: list[Assessment]

    @model_validator(mode="after")
    def consistent_outcome(self):
        if self.eligible_count > self.total_in_category:
            raise ValueError("Eligible count exceeds category count")
        if self.status != ("matched" if self.eligible_count else "no_match" if self.total_in_category else "no_category"):
            raise ValueError("Status disagrees with counts")
        if len(self.cards) != min(3, self.eligible_count) or len({card.id for card in self.cards}) != len(self.cards):
            raise ValueError("Show exactly the first available candidates, at most three")
        if (self.alternatives or self.suggestions) and self.status != "no_match":
            raise ValueError("Changed conditions require no_match")
        if len(self.assessments) != self.total_in_category or len({r.id for r in self.assessments}) != len(self.assessments):
            raise ValueError("Assess every candidate exactly once")
        eligible = sorted((r for r in self.assessments if r.rank is not None), key=lambda r: r.rank)
        if [r.rank for r in eligible] != list(range(1, self.eligible_count + 1)) or [r.id for r in eligible[:3]] != [c.id for c in self.cards]:
            raise ValueError("Cards and eligibility ranks disagree")
        for reason, count in self.rejections.model_dump().items():
            if count != sum(reason in row.reasons for row in self.assessments):
                raise ValueError("Rejection counts disagree with assessments")
        for suggestion in [*self.suggestions, *self.alternatives]:
            proposed = Query.model_validate({**self.query.model_dump(), **suggestion.changes})
            if any(getattr(proposed, key) == getattr(self.query, key) for key in suggestion.changes):
                raise ValueError("A change must differ from the original query")
        for card, query in [(card, self.query) for card in self.cards] + [
            (alt.card, Query.model_validate({**self.query.model_dump(), **alt.changes})) for alt in self.alternatives
        ]:
            if (card.city != query.city or query.category not in card.categories or card.available_on != query.date
                    or card.price_from_kzt > query.budget_kzt or (query.language and query.language not in card.languages)
                    or (query.duration_hours is not None and card.max_hours is not None and query.duration_hours > card.max_hours)):
                raise ValueError("Card does not satisfy its declared conditions")
        return self


class MatchedRecommendation(Recommendation):
    status: Literal["matched"]
    eligible_count: int = Field(ge=1)
    cards: list[Card] = Field(min_length=1, max_length=3)


class NoMatchRecommendation(Recommendation):
    status: Literal["no_match"]
    total_in_category: int = Field(ge=1)
    eligible_count: Literal[0]
    cards: list[Card] = Field(max_length=0)


class NoCategoryRecommendation(Recommendation):
    status: Literal["no_category"]
    total_in_category: Literal[0]
    eligible_count: Literal[0]
    cards: list[Card] = Field(max_length=0)


RecommendationResponse = Annotated[
    MatchedRecommendation | NoMatchRecommendation | NoCategoryRecommendation, Field(discriminator="status")]
