"""Report Q01/Q02/Q03: useful source facts, complete thoughts, correct summaries."""
import re

import pytest

from qa.test_recommendation_http import api, recommend


def source_quote(card):
    quote = next(item["value"] for item in card["evidence"] if item["field"] == "description")
    assert quote in card["description"] and quote in card["explanation"]
    return quote


def assert_distinct_band_facts(cards):
    by_id = {card["id"]: card for card in cards}
    brass = by_id["HK-23752"]
    quartet = by_id["HK-83709"]
    assert all(fact in source_quote(brass) for fact in ("два вокалиста", "саксофон", "тромбон"))
    assert all(fact in source_quote(quartet) for fact in ("4 вокалиста", "струнный квартет", "перкуссионист"))
    def without_names(card):
        text = card["explanation"]
        for name in (card["name"], "Thunder Breath Band", "Eva Sound"):
            text = re.sub(re.escape(name), "[ИМЯ]", text, flags=re.I)
        return re.sub(r"\s+", " ", text).casefold()
    assert without_names(brass) != without_names(quartet)
    assert brass["price_from_kzt"] == quartet["price_from_kzt"] == 1150000


@pytest.mark.parametrize("date", ["2026-09-23", "2026-12-25"])
def test_band_reasons_distinguish_actual_service_facts_without_names(api, date):
    result = recommend(api, date=date, event_type="свадьба", category="Лайв-бэнд",
                       budget_kzt=10000000, duration_hours=None, language=None)
    assert result["status"] == "matched"
    assert result["meta"]["explanation_mode"] == "fallback"
    assert_distinct_band_facts(result["cards"])


def test_alternative_cards_also_use_distinguishing_source_facts(api):
    result = recommend(api, date="2026-09-23", event_type="свадьба", category="Лайв-бэнд",
                       budget_kzt=1100000, duration_hours=None, language=None)
    assert result["status"] == "no_match" and result["cards"] == []
    assert_distinct_band_facts([option["card"] for option in result["alternatives"]])


def test_long_wedding_quote_keeps_the_end_of_the_thought(api):
    result = recommend(api, date="2026-09-23", event_type="свадьба", budget_kzt=10000000,
                       duration_hours=10, language="казахский")
    card = next(card for card in result["cards"] if card["id"] == "HK-42352")
    quote = source_quote(card)
    assert "13 лет" in quote
    assert quote == "Опыт ведения свадеб 13 лет" or quote.endswith("день запомнился всем на всю жизнь")
    assert "чтобы этот»." not in card["explanation"]
    assert card["price_imputed"] is True


@pytest.mark.parametrize("city", ["Астана", "Алматы"])
def test_single_florist_summary_has_correct_agreement(api, city):
    result = recommend(api, city=city, event_type="свадьба", category="Флорист",
                       budget_kzt=300000, duration_hours=None, language=None)
    assert result["eligible_count"] == 1
    assert "1 профиль" in result["summary"]
    assert "1 профилей" not in result["summary"] and "1 не проходят" not in result["summary"]
    if city == "Алматы":
        assert result["rejections"]["busy"] == 1 and "заняты" in result["summary"]
