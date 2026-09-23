# Готовое приложение для организаторов

Организатор получает `SatContractors-Windows.zip`, распаковывает весь архив и запускает `SatContractors/Start.exe`. Внутри папки нужно сохранить `_internal`: там находятся встроенный Python, библиотеки, сайт и исходный набор. Отдельная установка Python или Node.js для запуска EXE не требуется.

После открытия запускается сайт на http://127.0.0.1:8765. Консоль показывает адрес, пути к настройкам и базе. Закрывайте её после завершения проверки. Если порт занят, второй запуск завершается с понятной ошибкой; можно выбрать `Start.exe --port 8766`.

Локальная конфигурация `%LOCALAPPDATA%\SatContractors\.env` создаётся один раз с новым случайным кодом администратора. Не публикуйте её. Админ-панель использует значение `ADMIN_API_TOKEN`; ключ `OPENAI_API_KEY` необязателен для базовых сценариев, но нужен для живых объяснений ИИ. После редактирования конфигурации перезапустите программу.

## Воспроизводимая сборка командой

На Windows x64, после установки зависимостей backend и сборки frontend:

```powershell
.\.venv\Scripts\python.exe -m pip install -r packaging/requirements.txt
.\.venv\Scripts\python.exe scripts/build_windows.py
.\.venv\Scripts\python.exe scripts/verify_windows.py release/SatContractors-Windows.zip --browser
```

Результат: `release/SatContractors-Windows.zip`. Скрипт сборки использует явный список ресурсов: frontend/dist и data/contractors.csv. Локальные `.env`, рабочие базы и окружение `.venv` в этот список не входят. Существующий результат не перезаписывается: для новой сборки укажите `--output release/another-build`.

Verifier распаковывает архив в новую папку с пробелом и кириллицей, запускает именно EXE из другого рабочего каталога с PATH без Python и Node, проверяет страницы и настоящий API. Затем создаёт тестовый профиль, останавливает процесс и проверяет сохранность после запуска с недоступным CSV. С параметром `--browser` выполняются девять существующих браузерных тестов реального API на этом EXE. Node/Playwright нужны только разработчику для этих проверок, не организаторам. Все изменения делаются во временной базе.

`release/` исключён из Git. Готовый ZIP передаётся отдельно или прикладывается к релизу GitHub. GitHub «Download ZIP» скачивает исходники, для которых действует установка через `scripts/setup.ps1` и запуск `python run.py`.

## Проверка из исходников

Windows: `scripts/setup.ps1`, затем `.venv\Scripts\python.exe run.py`. Linux/macOS: создайте venv, установите `backend/requirements-lock.txt`, выполните `npx pnpm@11.19.0 install --frozen-lockfile` и `npx pnpm@11.19.0 build` в frontend, затем `.venv/bin/python run.py` из корня.

Если нужные инструменты не находятся на PATH, setup принимает `-Python <путь к Python 3.12+>` и `-Pnpm <путь к pnpm 11.19.0>`. Стандартный вариант использует npx из установки Node.js. Подтверждённые результаты: [проверка поставки](distribution-verification.md).

Альтернативный запуск без launcher: `python -m uvicorn backend.application:create_app --factory --host 127.0.0.1 --port 8765`. При наличии frontend/dist сайт обслуживается тем же сервером. Существующий вход `backend.app:app` сохранён для совместимости.
