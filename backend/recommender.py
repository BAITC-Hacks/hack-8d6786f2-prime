import re
from dataclasses import dataclass
from datetime import timedelta

from .catalog import CALENDAR_MAX, Catalog, Contractor
from .models import Query, Rejections, Suggestion

STOPWORDS = {"для", "это", "как", "что", "чтобы", "или", "без", "нужен", "нужна", "нужно", "хочу", "нам", "при", "под", "его", "она", "они", "так", "все", "наш", "наша"}


def tokens(text: str) -> set[str]:
    return set(re.findall(r"[а-яa-z]{3,}", text.casefold().replace("ё", "е"))) - STOPWORDS


def rejection_reasons(item: Contractor, query: Query) -> list[str]:
    reasons = []
    if query.date in item.busy_dates:
        reasons.append("busy")
    if item.price_from_kzt > query.budget_kzt:
        reasons.append("budget")
    if query.event_type not in item.event_formats:
        reasons.append("event_type")
    if query.language is not None and query.language not in item.languages:
        reasons.append("language")
    if query.duration_hours is not None and item.max_hours is not None and query.duration_hours > item.max_hours:
        reasons.append("duration")
    return reasons


@dataclass
class Selection:
    status: str
    base: list[Contractor]
    eligible: list[Contractor]
    rejections: Rejections
    summary: str


def select(catalog: Catalog, query: Query) -> Selection:
    base = [r for r in catalog.records if r.city == query.city and query.category in r.categories]
    rejected = Rejections()
    eligible = []
    for item in base:
        reasons = rejection_reasons(item, query)
        for reason in reasons:
            setattr(rejected, reason, getattr(rejected, reason) + 1)
        if not reasons:
            eligible.append(item)
    preference_tokens = tokens(query.preferences)
    eligible.sort(key=lambda r: (-len(tokens(r.description) & preference_tokens), r.price_from_kzt, r.id))
    if not base:
        return Selection("no_category", base, [], rejected,
                         f'В городе «{query.city}» нет профилей категории «{query.category}» в этом каталоге.')
    if not eligible:
        labels = {"busy": "занятость на дату", "budget": "стартовая цена выше бюджета",
                  "event_type": "формат мероприятия", "language": "язык", "duration": "длительность"}
        reasons_text = "; ".join(labels[k] for k, v in rejected.model_dump().items() if v)
        return Selection("no_match", base, [], rejected,
                         f"В категории найдено {len(base)} профилей, но ни один не проходит все условия. Причины исключения: {reasons_text}.")
    total = len(eligible)
    if total < 3:
        summary = f"Подходит профилей: {total}. Показываем все; остальные профили этой категории отсутствуют в каталоге или не проходят условия."
    else:
        summary = f"Подходит профилей: {total}. Показываем 3 по правилам подбора."
    return Selection("matched", base, eligible, rejected, summary)


def alternatives(catalog: Catalog, query: Query, selection: Selection) -> list[Suggestion]:
    if selection.status != "no_match":
        return []
    # Only suggest dates that pass every other original constraint.
    for offset in range(1, 15):
        candidate_date = query.date + timedelta(days=offset)
        if candidate_date > CALENDAR_MAX:
            break
        alternative = query.model_copy(update={"date": candidate_date})
        if any(not rejection_reasons(item, alternative) for item in selection.base):
            return [Suggestion(label=f"Проверить {candidate_date.strftime('%d.%m.%Y')}",
                               changes={"date": candidate_date.isoformat()})]
    return []
