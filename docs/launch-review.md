# Проверка запуска с нуля

23.09.2026. Проверен commit `17c30b8d1b7275709a5686395ce8a62565c0c576`.
Linux, Python 3.14.4. В README указан Python 3.12: именно эта версия не проверялась.

## Изоляция и источник

Создана новая папка `work/launch-review` вне рабочего репозитория команды и новое `.venv`.
Через `git archive HEAD` получены только файлы коммита: без текущего `.venv`, `.env`,
секретов и незакоммиченных QA-файлов. Архив извлечён Python tarfile с `filter='data'`.
Это проверка чистого снимка, не проверка доступа к GitHub или операции clone.

Точная папка проверенного снимка в окружении QA:
`/home/artem/Documents/Codex/2026-09-23/github-git-git-reset-rebase-force/work/launch-review`.
Это временный локальный путь, не требование для других участников.
Основной сервер на 8000 не останавливался. Тестовый Uvicorn слушал только 127.0.0.1:18080.
Завершались только процессы, запущенные этой проверкой. Файлы команды не удалялись.

## Реально выполненные команды и результаты

Из родительской рабочей папки после извлечения снимка:

```sh
python3 -m venv work/launch-review/.venv
work/launch-review/.venv/bin/python -m pip install -r work/launch-review/backend/requirements-lock.txt
```

PASS: установка всех 23 закреплённых пакетов в новое окружение, включая бинарный
pydantic_core для Python 3.14. Пакеты скачивались заново; pip cache был недоступен,
поэтому pip отключил кеш. Это предупреждение среды, установка завершилась успешно.

Из корня снимка:

```sh
.venv/bin/python -m pip check
PYTHONDONTWRITEBYTECODE=1 PYTHON_DOTENV_DISABLED=1 OPENAI_API_KEY='' NVIDIA_API_KEY='' .venv/bin/python -m pytest backend/tests -q -p no:cacheprovider
```

PASS: `No broken requirements found`; **52 passed, 0 failed, 0 skipped**, 0.64 s.
Одно `StarletteDeprecationWarning` о httpx в TestClient. Зависимости не обновлялись.

Запуск через subprocess эквивалентен команде из корня снимка:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHON_DOTENV_DISABLED=1 OPENAI_API_KEY='' NVIDIA_API_KEY='' LLM_PROVIDER=openai LLM_TIMEOUT_SECONDS=6 .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 18080
```

Первый запуск проверял явный `CONTRACTORS_CSV`, равный абсолютному пути к CSV снимка.
Финальный запуск выполнялся с удалённой из окружения переменной `CONTRACTORS_CSV`:
проверен путь по умолчанию. Оба запуска PASS.

`GET /api/health`: HTTP 200, status=ok, ai_available=false,
dataset_version=`87d082de8481f63795ba9d5b9509b5ffbdeabe3f99efd28b114be780df35d422`.
Справочники и POST проверены независимым HTTP-набором, читающим CSV снимка.

Команда финального прогона из корня снимка (QA-файл ещё не включён в исходный коммит):

```sh
BASE_URL=http://127.0.0.1:18080 QA_CSV_PATH="$PWD/data/contractors.csv" PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest /home/artem/java-backend/haskathon/hack-8d6786f2-prime/qa/test_acceptance.py -q -s -p no:cacheprovider
```

PASS: **50 passed, 0 failed, 0 skipped**, 0.20 s.
Wall-clock для трёх контрольных запросов: 0.0017 / 0.0011 / 0.0010 секунды.
Это локальный fallback без нагрузки и без внешней модели.

## Перезапуск

Первый тестовый процесс штатно завершён через terminate/wait, затем запущен новый
процесс с тем же снимком и параметрами. На обоих экземплярах базовый запрос
Алматы / Ведущий / корпоратив / 2026-11-14 / 1500000 / русский / 6 ч дал:

```text
HK-44923 → HK-29829 → HK-27222
```

PASS: порядок совпал после реального перезапуска Uvicorn. Это отдельная проверка,
она не входит в счётчик 50 acceptance-тестов. Тестовые процессы после проверки завершены.

## Настройки, недостающие проверки

`backend/.env.example` просмотрен: пустые ключи, LLM_PROVIDER=openai, таймаут 6,
необязательный CONTRACTORS_CSV. Создавать `.env` для fallback не требуется.
Файл с реальными секретами не читался и в снимок не копировался.

README достаточен для выполненного backend-запуска, если Python с модулем venv уже
установлен. Установка системного Python/venv на чистую ОС не проверялась.
Python 3.12, Windows, внешняя LLM, GitHub clone, развёртывание и нагрузка не проверялись.
В текущем снимке не обнаружены package.json и исходники frontend; ветки не переключались,
поэтому существование frontend в другой ветке не опровергается. Сквозной браузерный
сценарий, мобильная версия, обработка сетевой ошибки и отсутствие mock-подмены — PENDING.
