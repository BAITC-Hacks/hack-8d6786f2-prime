"""Complete source excerpts and explainable, name-independent evidence selection."""
import re

from .catalog import Contractor
from .models import Query


SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+|(?<=[.!?…])(?=[А-ЯЁA-Z])|[\r\n•]+")
# A heading starts a new list; a character count is never a phrase boundary.
TOPIC_BREAK = re.compile(
    r"\s+(?=(?:Репертуар(?:\s+(?:включает|охватывает)|\s*:)|"
    r"(?:Расширенный|Большой)\s+(?:музыкальный\s+)?состав\b|"
    r"(?:Форматы|Что вас ждёт|Ключевые моменты)\s*:))"
)
INVITATION = re.compile(
    r"\b(?:свяжитесь|связывайтесь|звоните|позвоните|пишите|напишите|обращайтесь|"
    r"закажите|заказывайте|забронируйте|бронируйте|оставьте\s+(?:заявку|контакт\w*|номер)|"
    r"успейте\s+(?:заказать|забронировать)|"
    r"готов(?:а|ы|о)?\s+выступить\s+на\s+ваш\w*\s+(?:торжеств|мероприяти|праздник)\w*)\b", re.I
)
PROMOTIONAL = re.compile(
    r"идеальн\w*\s+(?:впиш|подойд|подход)|профессионалы своего дела|"
    r"любовь к музыке|парад незабываемых|настоящий праздник|незабываем\w*\s+впечатлен|"
    r"сам\w*\s+(?:лучш|востребован)|топ[ -]?\d|№\s*1", re.I
)
INTRO = re.compile(r"^(?:привет|здравствуйте|меня зовут|я[, ]|мы\s+[—–-]|коротко обо мне|дорог|с уважением)", re.I)
# Names and generic promises are deliberately absent from the feature vocabulary.
FACT_STEMS = (
    "вокалист", "вокал", "квартет", "струнн", "духов", "перкусс", "барабан", "гитар",
    "саксофон", "скрипк", "труб", "тромбон", "контрабас", "домбр", "джаз", "ретро",
    "кавер", "репертуар", "акуст", "хореограф", "танц", "сценари", "импровизац",
    "интерактив", "конкурс", "юмор", "театр", "актер", "педагог", "телеведущ",
    "репортаж", "портрет", "съемк", "снимк", "печать", "печат", "фотобуд",
    "зеркал", "сенсор", "фотозон", "светов", "пиксельн", "мультимедийн", "оборудован",
    "флорист", "цвет", "палитр", "букет", "композиц", "декор", "инсталляц", "неон",
    "гирлянд", "монтаж", "эскиз", "мерч", "сувенир", "брендирован", "тираж",
    "открытк", "подарочн", "регистрац", "церемони", "вместим", "кейтеринг",
    "парковк", "террас", "панорам", "кухн", "презентац", "dj",
)
FACT_PATTERN = re.compile(r"\b(" + "|".join(FACT_STEMS) + r")\w*", re.I)
QUANTITY = re.compile(
    r"\b(\d+(?:[.,]\d+)?|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)"
    r"[ -]+(вокалист\w*|гост\w*|человек|съем\w*|заказ\w*|свад\w*|зал\w*|час\w*|штук)\b", re.I
)
EXPERIENCE = re.compile(
    r"\b(?:опыт\w*|стаж|вед\w*|созда\w*|работ\w*|на рынке)"
    r"[^.!?\n]{0,40}?\b(\d+[ -]+(?:лет|год\w*))\b", re.I
)
# A labelled measure is a complete fact even in an unpunctuated paragraph.
EXPERIENCE_CLAUSE = re.compile(
    r"\b(?:Опыт|Стаж)\b[^.!?\n:]{0,60}?\b\d+\s+(?:лет|год[а]?)(?!\w)"
)
FORMAT_STEMS = {
    "свадьба": ("свад", "невест", "молодож"),
    "той": ("той", "традиц", "националь"),
    "корпоратив": ("корпоратив", "бизнес", "делов"),
    "конференция": ("конференц", "форум", "делов"),
    "юбилей": ("юбиле",),
    "день рождения": ("рождени", "именин"),
}


def excerpts(description: str) -> list[str]:
    """Return verbatim complete sentences/list items; never cut mid-thought."""
    parts = []
    for sentence in SENTENCE_BREAK.split(description):
        for part in TOPIC_BREAK.split(sentence):
            clean = part.strip().rstrip(".!?… ")
            if clean and clean not in parts:
                parts.append(clean)
            if len(clean) > 220:
                for match in EXPERIENCE_CLAUSE.finditer(clean):
                    if match.group(0) not in parts:
                        parts.append(match.group(0))
    return parts or [description.strip()]


def fact_signals(text: str) -> set[str]:
    normalized = text.casefold().replace("ё", "е")
    features = {match.group(1) for match in FACT_PATTERN.finditer(normalized)}
    features.update("quantity:" + match.group(0) for match in QUANTITY.finditer(normalized))
    features.update("experience:" + match.group(1) for match in EXPERIENCE.finditer(normalized))
    return features


def candidate_indices(item: Contractor, snippets: list[str], peers=()) -> list[int]:
    """Constrain both fallback and LLM to useful evidence available in the source."""
    indices = list(range(len(snippets)))
    # Conditional filters: poor source data must not produce invented facts.
    for useful in (
        lambda text: not INVITATION.search(text),
        lambda text: bool(fact_signals(text)),
        lambda text: not PROMOTIONAL.search(text),
        lambda text: not INTRO.search(text),
    ):
        preferred = [i for i in indices if useful(snippets[i])]
        if preferred:
            indices = preferred
    others = set().union(*(fact_signals(peer.description) for peer in peers if peer.id != item.id))
    distinctive = [i for i in indices if fact_signals(snippets[i]) - others]
    indices = distinctive or indices
    concise = [i for i in indices if len(snippets[i]) <= 220]
    return concise or indices


def evidence_score(text: str, query: Query):
    normalized = text.casefold().replace("ё", "е")
    return (len(fact_signals(text)),
            sum(stem in normalized for stem in FORMAT_STEMS.get(query.event_type, ())),
            -len(text))
