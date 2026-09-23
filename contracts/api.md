# Контракт API

Версия приложения 3.0.0. Точная JSON-схема доступна в `/openapi.json`. Три маршрута:

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
- `meta`: dataset_version, explanation_mode (llm/fallback), latency_ms.
- `suggestions`: проверенная следующая дата в пределах 14 дней, если применима, с label и changes.
- `alternatives`: до трёх отдельных вариантов только при no_match. Каждый содержит card, changes, differences и explanation_mode=fallback.

`changes` альтернативы меняет только date, budget_kzt, language или duration_hours. В differences перечислены field, requested, proposed, reason. После применения изменений требуется новый запрос. Город, категория и формат сохраняются; предложенная дата действительно свободна. При no_match точные cards всегда пусты, даже если есть alternatives.

При `max_hours=null` ограничение присутствия не применяется. Цена «от» не означает окончательную стоимость. `evidence` подтверждает опору на данные, но не является независимой проверкой заявлений профиля.

Невалидный запрос — 422 с `detail` (loc/msg/type), слишком большое тело — 413. Сбой модели сохраняет подходящие карточки с fallback. Все ответы имеют Cache-Control: no-store. Порядок — цена, затем id; модель его не меняет.
