"""Validated write models. No identity, privilege or provenance fields are client-controlled."""
import re
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Literal

from .catalog import CALENDAR_MIN, CALENDAR_MAX


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=1, max_length=80)
    categories: list[str] = Field(min_length=1, max_length=17)
    event_formats: list[str] = Field(min_length=1, max_length=6)
    languages: list[str] = Field(min_length=1, max_length=3)
    price_from_kzt: int = Field(strict=True, ge=1, le=1_000_000_000)
    max_hours: float | None = Field(default=None, strict=True, gt=0, le=24, allow_inf_nan=False)
    busy_dates: list[date] = Field(default_factory=list, max_length=100)
    description: str = Field(min_length=30, max_length=3000)
    contact_email: str = Field(min_length=3, max_length=254)
    synthetic: bool = Field(default=False, strict=True)

    @field_validator("name", "city", "description", "contact_email")
    @classmethod
    def safe_text(cls, value, info):
        permitted = "\n\r\t" if info.field_name == "description" else ""
        if any((ord(char) < 32 and char not in permitted) or ord(char) == 127 for char in value):
            raise ValueError("Текст содержит недопустимые управляющие символы")
        return value

    @field_validator("contact_email")
    @classmethod
    def email(cls, value):
        if not re.fullmatch(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+", value):
            raise ValueError("Укажите корректный email")
        return value.casefold()

    @field_validator("categories", "event_formats", "languages")
    @classmethod
    def unique_choices(cls, values):
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 80 for value in cleaned) or len(set(cleaned)) != len(cleaned):
            raise ValueError("Выберите значения без повторов и пустых строк")
        return sorted(cleaned)

    @field_validator("busy_dates", mode="before")
    @classmethod
    def exact_dates(cls, values):
        if not isinstance(values, list):
            raise ValueError("Занятые даты должны быть списком")
        if any(type(value) is not date and not (isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)) for value in values):
            raise ValueError("Даты должны иметь формат YYYY-MM-DD")
        return values

    @field_validator("busy_dates")
    @classmethod
    def calendar(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Занятые даты не должны повторяться")
        if any(not CALENDAR_MIN <= value <= CALENDAR_MAX for value in values):
            raise ValueError("Дата должна входить в календарь с 23.09.2026 по 31.12.2026")
        return sorted(values)


class ModerationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Literal["approved", "rejected"]
    expected_revision: int = Field(strict=True, ge=1)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def rejection_reason(self):
        if self.decision == "rejected" and len(self.note) < 3:
            raise ValueError("Укажите причину отклонения, не менее трёх символов")
        return self


class ApplicationReceipt(BaseModel):
    id: str
    status: Literal["pending"] = "pending"
    message: str = "Анкета отправлена на проверку. После одобрения она появится в подборе."


class AdminProfile(BaseModel):
    id: str
    name: str
    city: str
    categories: list[str]
    event_formats: list[str]
    languages: list[str]
    price_from_kzt: int
    max_hours: float | None
    busy_dates: list[date]
    description: str
    contact_email: str | None
    synthetic: bool
    price_imputed: bool
    city_imputed: bool
    status: Literal["pending", "approved", "rejected"]
    source: Literal["dataset", "application", "admin"]
    revision: int
    created_at: str
    updated_at: str
    moderation_note: str


class AdminListing(BaseModel):
    items: list[AdminProfile]
    total: int
    limit: int
    offset: int
    counts: dict[Literal["pending", "approved", "rejected"], int]
    storage: Literal["sqlite"] = "sqlite"
