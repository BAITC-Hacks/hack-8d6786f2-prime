"""Recommendation orchestration, independent of HTTP and application startup."""
import time

from .catalog import CALENDAR_MAX, CALENDAR_MIN
from .explainer import compose, excerpts, fallback_choice
from .models import Alternative, Assessment, Card, Meta, Recommendation
from .recommender import alternatives, nearby_candidates, rejection_reasons, select


class InvalidQuery(Exception):
    def __init__(self, errors):
        self.errors = errors


async def recommend(store, explainer, query):
    started = time.perf_counter()
    catalog = store.snapshot()
    errors = []
    if not CALENDAR_MIN <= query.date <= CALENDAR_MAX:
        errors.append({"loc": ["body", "date"], "msg": "Календарь доступен с 23.09.2026 по 31.12.2026", "type": "value_error"})
    for field, allowed in [("city", catalog.cities), ("category", catalog.categories),
                           ("event_type", catalog.event_types), ("language", catalog.languages)]:
        value = getattr(query, field)
        if value is not None and value not in allowed:
            errors.append({"loc": ["body", field], "msg": "Значение отсутствует в справочнике каталога", "type": "value_error"})
    if errors:
        raise InvalidQuery(errors)
    selection = select(catalog, query)
    top = selection.eligible[:3]
    diagnostics = {}
    explanations, mode = await explainer.explain(top, query, catalog.version, diagnostics=diagnostics)
    cards = [make_card(row, query, explanations[row.id]) for row in top]
    near = []
    nearby = nearby_candidates(query, selection)
    for row, proposed, changes, differences in nearby:
        snippets = excerpts(row.description)
        grounded = compose(row, proposed, fallback_choice(row, proposed, snippets,
                           [candidate[0] for candidate in nearby]), snippets)
        near.append(Alternative(card=make_card(row, proposed, grounded), changes=changes, differences=differences))
    ranks = {row.id: index + 1 for index, row in enumerate(selection.eligible)}
    assessments = [Assessment(id=row.id, name=row.name, rank=ranks.get(row.id),
                              status="selected" if row.id in ranks and ranks[row.id] <= 3 else
                                     "not_selected" if row.id in ranks else "excluded",
                              reasons=rejection_reasons(row, query)) for row in selection.base]
    return Recommendation(status=selection.status, query=query,
                          total_in_category=len(selection.base), eligible_count=len(selection.eligible),
                          cards=cards, summary=selection.summary, rejections=selection.rejections,
                          suggestions=alternatives(catalog, query, selection),
                          alternatives=near, assessments=assessments,
                          meta=Meta(dataset_version=catalog.version, explanation_mode=mode,
                                    ai=diagnostics, latency_ms=round((time.perf_counter() - started) * 1000)))


def make_card(row, query, explanation):
    return Card(id=row.id, name=row.name, categories=list(row.categories), city=row.city,
                price_from_kzt=row.price_from_kzt, languages=list(row.languages), max_hours=row.max_hours,
                available_on=query.date, description=row.description,
                explanation=explanation[0], evidence=explanation[1],
                synthetic=row.synthetic, price_imputed=row.price_imputed, city_imputed=row.city_imputed)
