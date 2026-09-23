from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Query(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    city: str = Field(min_length=1, max_length=80)
    date: Date
    event_type: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=80)
    budget_kzt: int = Field(gt=0, strict=True)
    duration_hours: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    language: str | None = Field(default=None, min_length=1, max_length=80)
    preferences: str = Field(default="", max_length=500)


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
    busy: int = 0
    budget: int = 0
    event_type: int = 0
    language: int = 0
    duration: int = 0


class Meta(BaseModel):
    dataset_version: str
    explanation_mode: Literal["llm", "fallback"]
    latency_ms: int


class Suggestion(BaseModel):
    label: str
    changes: dict[str, str | float | int | None]


class Recommendation(BaseModel):
    status: Literal["matched", "no_category", "no_match"]
    query: Query
    total_in_category: int
    eligible_count: int
    cards: list[Card]
    summary: str
    rejections: Rejections
    suggestions: list[Suggestion]
    meta: Meta
