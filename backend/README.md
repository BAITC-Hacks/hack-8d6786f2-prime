# Backend подбора

Python/FastAPI. Основной запуск всего приложения описан в [README](../README.md). Для разработки отдельного API:

```sh
python -m pip install -r backend/requirements-lock.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Настройки в локальном `backend/.env`, переменные процесса имеют приоритет. Шаблон — `.env.example`.

| Переменная | Назначение |
| --- | --- |
| LLM_PROVIDER | openai или nvidia |
| OPENAI_API_KEY / OPENAI_MODEL | Ключ и модель; по умолчанию gpt-4o-mini |
| NVIDIA_API_KEY / NVIDIA_MODEL | Ключ и модель NVIDIA |
| LLM_TIMEOUT_SECONDS | Общий таймаут объяснений: 6 с по умолчанию, максимум 8 с |
| DATABASE_PATH | SQLite; по умолчанию data/catalog.sqlite3 |
| CONTRACTORS_CSV | Источник первого импорта; по умолчанию data/contractors.csv |
| SAT_DATA_DIR | Отдельная папка настроек и состояния |
| SAT_FRONTEND_DIR | Необязательный путь к собранному frontend |

Без ключа используется fallback. Проверка живого провайдера: `python -m backend.check_llm`. `ai_available` не является проверкой доступности внешнего API. Для тестов задавайте временную базу, `PYTHON_DOTENV_DISABLED=1` и пустые ключи.

SQLite импортирует CSV один раз. Повторный запуск не перезаписывает готовую базу и работает без исходного CSV. HTTP-интерфейс не меняет каталог. Версия данных — SHA256 публичного снимка. Старые базы версии схемы 1 читаются без удаления их таблиц или частных полей; в публичный ответ попадают только поля карточки.

[API](../contracts/api.md) · [Архитектура](../docs/architecture.md) · [Ограничения](../docs/known-issues.md).
