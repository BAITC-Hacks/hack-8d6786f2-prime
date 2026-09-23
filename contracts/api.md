# Контракт API

Версия приложения 3.1.0. Точная JSON-схема доступна в `/openapi.json` и [openapi.json](openapi.json). Три маршрута:

| Метод | Путь | Ответ |
| --- | --- | --- |
| GET | /api/health | status, dataset_version, ai_available |
| GET | /api/options | cities, categories, event_types, languages, calendar, dataset |
| POST | /api/recommend | Подбор по запросу ниже |

```json
{"city":"Алматы","date":"2026-11-14","event_type":"корпоратив","category":"Ведущий","budget_kzt":1500000,"duration_hours":6,"language":"русский"}
```

Город, дата, формат, категория и бюджет обязательны. `language` и `duration_hours` могут отсутствовать или быть null. Бюджет — положительное целое число; длительность — положительное конечное число. Строки вместо чисел и логические значения не принимаются. Дата только YYYY-MM-DD в доступном окне. Значения справочников берутся из options. Лишние поля, включая удалённое `preferences`, возвращают 422. Регистрационных и административных маршрутов нет.

Ответ содержит:

- `status`: matched / no_category / no_match.
- `query`: нормализованные параметры.
- `total_in_category`, `eligible_count`: число профилей в городе/категории и прошедших условия.
- `cards`: максимум три точных совпадения. Поля карточки: id, name, categories, city, price_from_kzt, languages, max_hours, available_on, description, explanation, evidence, synthetic, price_imputed, city_imputed.
- `summary`: объяснение числа результатов или пустого исхода.
- `rejections`: busy, budget, event_type, language, duration. Причины могут пересекаться.
- `assessments`: все профили города/категории с id, name, status (`selected`, `not_selected`, `excluded`), reasons и rank. Исключённые имеют причины и rank=null; подходящие — пустые причины и последовательный rank от 1. Первые три — selected.
- `meta`: dataset_version, explanation_mode (llm/fallback), latency_ms и ai.
- `meta.ai`: cache_hit, shared_inflight, quality_repaired, fallback_reason, elapsed_ms. `quality_repaired=true` означает восстановление более конкретных цитат сервером; аспект объяснения от модели сохраняется, режим остаётся llm. Причины fallback: no_candidates, not_configured, circuit_open, overloaded, rate_limit, session_budget, timeout, provider_http, provider_network, invalid_response; при успехе null.
- `suggestions`: проверенная следующая дата в пределах 14 дней, если применима, с label и changes.
- `alternatives`: до трёх отдельных вариантов только при no_match. Каждый содержит card, changes, differences и explanation_mode=fallback.

`changes` альтернативы меняет только date, budget_kzt, language или duration_hours. В differences перечислены field, requested, proposed, reason. После применения изменений требуется новый запрос. Город, категория и формат сохраняются; предложенная дата действительно свободна. При no_match точные cards всегда пусты, даже если есть alternatives.

При `max_hours=null` ограничение присутствия не применяется. Цена «от» не означает окончательную стоимость. `evidence` подтверждает опору на данные, но не является независимой проверкой заявлений профиля.

`evidence.field=description_limitation` отмечает недостаток конкретных отличий в исходном описании. Ограничение видно и в explanation.

Backend и Zod проверяют максимум три карточки и согласованность status, счётчиков, рангов и причин. OpenAPI содержит union с discriminator=status. `changes` у suggestions и alternatives допускает только четыре названных поля, не может быть пустым или повторять исходные условия. Frontend отклоняет четвёртую карточку как неверный контракт.

Обновление: `python scripts/export_openapi.py`, затем `pnpm --dir frontend api:generate`. Проверка актуальности: Python-команда с `--check` и `pnpm --dir frontend api:check`. Query, Card, Options берутся из генерируемых типов, тип проверенного ответа Zod сверяется с OpenAPI. Браузерный набор проверяет реальные ответы 28 запросов той же Zod-схемой.

Невалидный запрос — 422 с `detail` (loc/msg/type), слишком большое тело — 413. Сбой модели сохраняет подходящие карточки с fallback. Все ответы имеют Cache-Control: no-store. Порядок — цена, затем id; модель его не меняет.
