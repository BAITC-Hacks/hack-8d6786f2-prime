import csv
import hashlib
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

CALENDAR_MIN = date(2026, 9, 23)
CALENDAR_MAX = date(2026, 12, 31)
REQUIRED = {"id", "anon_name", "categories", "city", "city_imputed", "synthetic",
            "price_from_kzt", "price_imputed", "event_formats", "languages",
            "max_hours", "busy_dates", "description"}


@dataclass(frozen=True)
class Contractor:
    id: str
    name: str
    categories: tuple[str, ...]
    city: str
    price_from_kzt: int
    event_formats: tuple[str, ...]
    languages: tuple[str, ...]
    max_hours: float | None
    busy_dates: frozenset[date]
    description: str
    synthetic: bool
    price_imputed: bool
    city_imputed: bool


def split_list(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split("|") if part.strip())


def boolean(value: str) -> bool:
    if value not in {"True", "False"}:
        raise ValueError("Boolean fields must contain True or False")
    return value == "True"


class Catalog:
    def __init__(self, path: Path):
        self.version = hashlib.sha256(path.read_bytes()).hexdigest()
        records = []
        seen = set()
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not REQUIRED.issubset(reader.fieldnames or []):
                raise ValueError("CSV is missing required columns")
            if len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise ValueError("CSV contains duplicate column names")
            for line, row in enumerate(reader, 2):
                try:
                    if None in row or any(row[key] is None for key in REQUIRED):
                        raise ValueError("CSV record has an unexpected number of fields")
                    if any(row[key] is None or not row[key].strip() for key in REQUIRED - {"max_hours", "busy_dates"}):
                        raise ValueError("A required field is empty")
                    item = Contractor(
                        id=row["id"].strip(), name=row["anon_name"].strip(),
                        categories=split_list(row["categories"]), city=row["city"].strip(),
                        price_from_kzt=int(row["price_from_kzt"]),
                        event_formats=split_list(row["event_formats"]), languages=split_list(row["languages"]),
                        max_hours=float(row["max_hours"]) if row["max_hours"].strip() else None,
                        busy_dates=frozenset(date.fromisoformat(d) for d in split_list(row["busy_dates"])),
                        description=row["description"].strip(), synthetic=boolean(row["synthetic"]),
                        price_imputed=boolean(row["price_imputed"]), city_imputed=boolean(row["city_imputed"]),
                    )
                    if not item.categories or not item.languages or not item.event_formats:
                        raise ValueError("Lists cannot be empty")
                    if item.id in seen:
                        raise ValueError("Duplicate contractor id")
                    if item.price_from_kzt <= 0 or (item.max_hours is not None and not 0 < item.max_hours < float("inf")):
                        raise ValueError("Price and applicable duration must be positive finite numbers")
                    if any(not CALENDAR_MIN <= d <= CALENDAR_MAX for d in item.busy_dates):
                        raise ValueError("Busy date lies outside the dataset calendar")
                    if len(split_list(row["busy_dates"])) != len(item.busy_dates):
                        raise ValueError("Duplicate busy dates in one profile")
                    seen.add(item.id)
                    records.append(item)
                except (ValueError, TypeError, AttributeError) as exc:
                    raise ValueError(f"Invalid CSV record on line {line}: {exc}") from exc
        if not records:
            raise ValueError("Catalog is empty")
        self._set_records(records)

    def _set_records(self, records, vocabulary=None):
        self.records = tuple(records)
        self.cities = sorted({r.city for r in records}) if vocabulary is None else vocabulary["cities"]
        self.categories = sorted({c for r in records for c in r.categories}) if vocabulary is None else vocabulary["categories"]
        self.event_types = sorted({c for r in records for c in r.event_formats}) if vocabulary is None else vocabulary["event_types"]
        self.languages = sorted({c for r in records for c in r.languages}) if vocabulary is None else vocabulary["languages"]

    @classmethod
    def from_records(cls, records, vocabulary):
        """An immutable snapshot of approved SQL records; safe even for an empty catalogue."""
        instance = cls.__new__(cls)
        records = sorted(records, key=lambda record: record.id)
        payload = [{**vars(record), "busy_dates": sorted(day.isoformat() for day in record.busy_dates)}
                   for record in records]
        instance.version = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        instance._set_records(records, vocabulary)
        return instance

    def options(self) -> dict:
        return {"cities": self.cities, "categories": self.categories,
                "event_types": self.event_types, "languages": self.languages,
                "calendar": {"min": CALENDAR_MIN.isoformat(), "max": CALENDAR_MAX.isoformat()},
                "dataset": {"version": self.version, "profiles_count": len(self.records)}}
