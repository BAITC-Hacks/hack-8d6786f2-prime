import re
from dataclasses import dataclass
from datetime import timedelta

from .catalog import CALENDAR_MAX, CALENDAR_MIN, Catalog, Contractor
from .models import Difference, Query, Rejections, Suggestion

STOPWORDS = {"для", "это", "как", "что", "чтобы", "или", "без", "нужен", "нужна", "нужно", "хочу", "нам", "при", "под", "его", "она", "они", "так", "все", "наш", "наша"}
REJECTION_LABELS = {"busy": "заняты на выбранную дату", "budget": "стартовая цена выше бюджета",
                    "event_type": "не указан выбранный формат", "language": "не указан выбранный язык",
                    "duration": "не подходит длительность"}


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


def explain_rejections(rejected: Rejections) -> str:
    counts = [(key, count) for key, count in rejected.model_dump().items() if count]
    text = "; ".join(f"{REJECTION_LABELS[key]} — {count}" for key, count in counts)
    overlap = " У одного профиля может быть несколько причин." if len(counts) > 1 else ""
    return f"Причины исключения: {text}.{overlap}" if counts else ""


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
        return Selection("no_match", base, [], rejected,
                         f"В этой категории в городе профилей: {len(base)}; ни один не проходит все условия. {explain_rejections(rejected)}")
    total = len(eligible)
    if total < 3:
        summary = f"Подходит профилей: {total}. Показываем все. "
        if len(base) == total:
            summary += f"В этой категории в городе в каталоге всего {len(base)} профилей."
        else:
            summary += f"Из {len(base)} профилей этой категории {len(base) - total} не проходят условия. {explain_rejections(rejected)}"
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


def nearby_candidates(query: Query, selection: Selection):
    """Separate counterfactuals: each candidate passes EVERY explicitly proposed condition."""
    if selection.status != "no_match":
        return []
    candidates = []
    dates = [CALENDAR_MIN + timedelta(days=i) for i in range((CALENDAR_MAX - CALENDAR_MIN).days + 1)]
    # Equal distances prefer a later date. No claim of availability outside the known calendar.
    dates.sort(key=lambda day: (abs((day - query.date).days), day < query.date, day))
    for item in selection.base:
        if query.event_type not in item.event_formats:
            continue
        changes = {}
        differences = []
        penalty = 0.0
        if query.date in item.busy_dates:
            available = next((day for day in dates if day not in item.busy_dates), None)
            if available is None:
                continue
            changes["date"] = available.isoformat()
            differences.append(Difference(field="date", requested=query.date.strftime("%d.%m.%Y"),
                                          proposed=available.strftime("%d.%m.%Y"), reason="На исходную дату подрядчик занят"))
            penalty += abs((available - query.date).days) / 7
        if item.price_from_kzt > query.budget_kzt:
            changes["budget_kzt"] = item.price_from_kzt
            differences.append(Difference(field="budget_kzt", requested=f"{query.budget_kzt:,} ₸".replace(",", " "),
                                          proposed=f"{item.price_from_kzt:,} ₸".replace(",", " "), reason="Стартовая цена выше исходного бюджета"))
            penalty += (item.price_from_kzt - query.budget_kzt) / query.budget_kzt
        if query.language and query.language not in item.languages:
            language = sorted(item.languages)[0]
            changes["language"] = language
            differences.append(Difference(field="language", requested=query.language, proposed=language,
                                          reason="Исходный язык не указан в профиле"))
            penalty += 1
        if query.duration_hours is not None and item.max_hours is not None and query.duration_hours > item.max_hours:
            changes["duration_hours"] = item.max_hours
            differences.append(Difference(field="duration_hours", requested=f"{query.duration_hours:g} ч",
                                          proposed=f"{item.max_hours:g} ч", reason="Подрядчик работает меньше запрошенной длительности"))
            penalty += (query.duration_hours - item.max_hours) / query.duration_hours
        proposed = Query.model_validate({**query.model_dump(), **changes})
        if not changes or rejection_reasons(item, proposed):
            continue
        candidates.append(((len(changes), penalty, item.price_from_kzt, item.id), item, proposed, changes, differences))
    candidates.sort(key=lambda value: value[0])
    return [(item, proposed, changes, differences) for _, item, proposed, changes, differences in candidates[:3]]
