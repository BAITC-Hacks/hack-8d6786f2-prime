import asyncio
import json
from dataclasses import replace

import httpx
import pytest

from backend.evidence import excerpts
from backend.explainer import Explainer, Settings
from backend.tests.test_explainer import context, provider_choices
from backend.recommender import select


def modified_bands():
    _, query, base = context()
    items = [
        replace(base[0], id="renamed-a", name="Новый коллектив А",
                description="На свадьбе Delta Band идеально впишется в любой формат мероприятия. "
                            "Состав: два вокалиста, саксофон и тромбон."),
        replace(base[1], id="renamed-b", name="Новый коллектив Б",
                description="На свадьбе Echo Band идеально впишется в любой формат мероприятия. "
                            "Состав: четыре вокалиста, струнный квартет и перкуссионист."),
    ]
    return query.model_copy(update={"event_type": "свадьба"}), items


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("provider", ["fallback", "openai", "nvidia"])
def test_distinction_is_not_tied_to_catalogue_ids_names_or_order(reverse, provider):
    query, items = modified_bands()
    if reverse:
        items.reverse()
    requests = []
    def handler(request):
        requests.append(request)
        candidates = json.loads(json.loads(request.content)["messages"][1]["content"])["candidates"]
        assert all("идеально" not in snippet["text"] for row in candidates for snippet in row["snippets"])
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(provider_choices(request))}}]})
    settings = Settings(provider="openai" if provider == "fallback" else provider,
                        api_key="" if provider == "fallback" else "test", model="test-model")
    result, mode = asyncio.run(Explainer(settings, httpx.MockTransport(handler)).explain(items, query, "synthetic"))
    assert mode == ("fallback" if provider == "fallback" else "llm")
    assert len(requests) == (0 if provider == "fallback" else 1)
    assert list(result) == [row.id for row in items]
    assert "саксофон и тромбон" in result["renamed-a"][0]
    assert "струнный квартет и перкуссионист" in result["renamed-b"][0]
    for item in items:
        assert result[item.id][1][0].value in item.description


def test_provider_cannot_reintroduce_a_real_but_rejected_advertising_excerpt():
    query, items = modified_bands()
    def handler(request):
        response = provider_choices(request)
        response["items"][0]["snippet_index"] = 0  # Exists in source, absent from supplied shortlist.
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(response)}}]})
    engine = Explainer(Settings(api_key="test"), httpx.MockTransport(handler))
    result, mode = asyncio.run(engine.explain(items, query, "synthetic"))
    assert mode == "fallback" and not engine.cache
    assert "саксофон и тромбон" in result["renamed-a"][0]
    assert "струнный квартет и перкуссионист" in result["renamed-b"][0]


def test_group_quality_guard_repairs_a_valid_but_less_distinct_venue_quote():
    catalog, query, _ = context()
    query = query.model_copy(update={"date": __import__('datetime').date(2026, 9, 23), "category": "Банкетный зал",
                                     "event_type": "свадьба", "budget_kzt": 10000000, "language": None, "duration_hours": None})
    items = select(catalog, query).eligible[:3]

    def handler(request):
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        response = provider_choices(request)
        row = next(row for row in payload["candidates"] if row["id"] == "HK-69010")
        weaker = next(snippet for snippet in row["snippets"] if "Локация сочетает" in snippet["text"])
        next(choice for choice in response["items"] if choice["id"] == row["id"])["snippet_index"] = weaker["index"]
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(response)}}]})

    async def run():
        engine = Explainer(Settings(api_key="test"), httpx.MockTransport(handler))
        diagnostics = {}
        result, mode = await engine.explain(items, query, catalog.version, diagnostics=diagnostics)
        assert mode == "llm" and diagnostics["quality_repaired"]
        assert "террасе" in result["HK-69010"][0] and "кухней" in result["HK-69010"][0]
        cached, _ = await engine.explain(items, query, catalog.version, diagnostics=diagnostics)
        assert cached == result and diagnostics["cache_hit"] and diagnostics["quality_repaired"]
        await engine.aclose()

    asyncio.run(run())


def test_long_sentence_and_decimal_quantities_are_not_cut():
    sentence = ("Для гостей организуем " + "музыкальные выступления, " * 12 +
                "которые завершаются совместным номером с оркестром")
    description = sentence + ". Сценическая программа длится 1.5 часа."
    assert sentence in excerpts(description)
    assert "Сценическая программа длится 1.5 часа" in excerpts(description)
    assert all(part in description for part in excerpts(description))


def test_inline_lists_remain_complete_at_the_next_topic_boundary():
    description = ("Расширенный состав: два вокалиста, саксофон и тромбон "
                   "Репертуар включает джазовые стандарты и ретро-хиты.")
    assert excerpts(description) == [
        "Расширенный состав: два вокалиста, саксофон и тромбон",
        "Репертуар включает джазовые стандарты и ретро-хиты",
    ]


def test_aspirational_years_are_not_preferred_over_real_photography_service():
    _, query, items = context()
    item = replace(items[0], description=(
        "Хочу, чтобы через 10 лет вы вспомнили свой незабываемый праздник. "
        "Специализируюсь на свадебной и репортажной съемке."
    ))
    result, _ = asyncio.run(Explainer(Settings()).explain([item], query, "photo"))
    assert "свадебной и репортажной съемке" in result[item.id][0]
    assert "через 10 лет" not in result[item.id][0]


@pytest.mark.parametrize("description", ["", "Свяжитесь с нами, чтобы обсудить ваше мероприятие."])
def test_sparse_data_never_invents_differentiating_details(description):
    _, query, items = context()
    item = replace(items[0], description=description)
    result, mode = asyncio.run(Explainer(Settings()).explain([item], query, "sparse"))
    assert mode == "fallback"
    assert all(word not in result[item.id][0] for word in ("саксофон", "квартет", "13 лет"))
    if description:
        assert result[item.id][1][0].value in description
    else:
        assert "нет подробного описания" in result[item.id][0]
