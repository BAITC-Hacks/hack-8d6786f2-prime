# Контракт API v1


Бэкенд: Python + FastAPI, порт 8000. Запуск из корня: `python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000`. Фронтенд использует относительный префикс `/api`, Vite перенаправляет его на localhost:8000. Все денежные значения в KZT, даты YYYY-MM-DD, тексты ответа на русском. Поля snake_case. Не меняй контракт молча.

GET /api/health

```json
{"status":"ok","dataset_version":"hash","ai_available":false}
```

`ai_available` означает, что ключ и модель настроены. Это не проверка авторизации или доступности провайдера. Фактически использованный режим конкретного подбора указан в `meta.explanation_mode`. Приложение сохраняет работоспособность при fallback.

GET /api/options

```json
{
  "cities":["Алматы","Астана","Зарубежье"],
  "categories":["Ведущий","Флорист"],
  "event_types":["свадьба","той","корпоратив","конференция","юбилей","день рождения"],
  "languages":["русский","казахский","английский"],
  "calendar":{"min":"2026-09-23","max":"2026-12-31"},
  "dataset":{"version":"hash","profiles_count":66}
}
```

Это пример: categories и другие списки заполняй из всех исходных данных, не ограничивай двумя категориями примера.

POST /api/recommend принимает:

```json
{
  "city":"Алматы",
  "date":"2026-11-14",
  "event_type":"корпоратив",
  "category":"Ведущий",
  "budget_kzt":1500000,
  "duration_hours":6,
  "language":"русский",
  "preferences":""
}
```

duration_hours и language допускают null; preferences по умолчанию пустая строка. Остальные поля обязательны. Ошибки входных данных: HTTP 422 с обычным FastAPI detail. Ошибки сервера: понятное сообщение без секретов. Не выдавай ошибку LLM за отсутствие кандидатов.

Успешный ответ, включая пустую выдачу, HTTP 200:

```json
{
  "status":"matched",
  "query":{"city":"Алматы","date":"2026-11-14","event_type":"корпоратив","category":"Ведущий","budget_kzt":1500000,"duration_hours":6,"language":"русский","preferences":""},
  "total_in_category":10,
  "eligible_count":4,
  "cards":[
    {
      "id":"id-from-csv",
      "name":"anon_name-from-csv",
      "categories":["Ведущий"],
      "city":"Алматы",
      "price_from_kzt":650000,
      "languages":["русский"],
      "max_hours":8,
      "available_on":"2026-11-14",
      "description":"Полное исходное описание",
      "explanation":"Обоснование на основе данных",
      "evidence":[{"field":"price_from_kzt","value":"650000"}],
      "synthetic":false,
      "price_imputed":false,
      "city_imputed":false
    }
  ],
  "summary":"Найдено 4 подходящих подрядчика. Показываем 3.",
  "rejections":{"busy":0,"budget":0,"event_type":0,"language":0,"duration":0},
  "suggestions":[],
  "meta":{"dataset_version":"hash","explanation_mode":"llm","latency_ms":1200}
}
```

Карточка и нулевые rejections здесь иллюстрируют схему, не готовый правильный ответ. Реальные значения рассчитывай. evidence — массив пар field/value с подтверждающими фактами. explanation_mode имеет значения llm/fallback. status имеет значения matched/no_category/no_match. При отсутствии результата cards=[], eligible_count=0; прочие обязательные поля сохраняются. Suggestions, если реализованы: массив `{"label":"Проверить другую дату","changes":{"date":"2026-11-15"}}`; changes содержит допустимое подмножество полей запроса.
