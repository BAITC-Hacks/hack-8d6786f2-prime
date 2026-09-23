import csv
from pathlib import Path

import pytest

from backend.catalog import Catalog

SOURCE = Path(__file__).resolve().parents[2] / "data" / "contractors.csv"


def sample():
    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return reader.fieldnames, next(reader)


def write_csv(path, rows):
    fields, _ = sample()
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


def test_source_catalog_and_version():
    catalog = Catalog(SOURCE)
    assert len(catalog.records) == len({r.id for r in catalog.records}) == 66
    assert sum(r.synthetic for r in catalog.records) == 13
    assert sum(r.price_imputed for r in catalog.records) == 18
    assert sum(r.city_imputed for r in catalog.records) == 8
    assert catalog.version == Catalog(SOURCE).version


def test_bom_and_null_duration(tmp_path):
    _, row = sample()
    row["max_hours"] = ""
    catalog = Catalog(write_csv(tmp_path / "catalog.csv", [row]))
    assert catalog.records[0].max_hours is None


@pytest.mark.parametrize("field,value", [("price_from_kzt", "0"), ("max_hours", "NaN"),
                                         ("busy_dates", "2027-01-01"), ("description", ""),
                                         ("synthetic", "maybe"), ("categories", "||"),
                                         ("busy_dates", "2026-11-14|2026-11-14")])
def test_bad_records_fail_with_line_number(tmp_path, field, value):
    _, row = sample()
    row[field] = value
    with pytest.raises(ValueError, match="line 2"):
        Catalog(write_csv(tmp_path / "bad.csv", [row]))


def test_duplicate_ids_rejected(tmp_path):
    _, row = sample()
    with pytest.raises(ValueError, match="Duplicate contractor id"):
        Catalog(write_csv(tmp_path / "duplicate.csv", [row, row]))


def test_missing_columns_rejected(tmp_path):
    path = tmp_path / "missing.csv"
    path.write_text("id,name\nx,Test\n", encoding="utf-8")
    with pytest.raises(ValueError, match="required columns"):
        Catalog(path)
