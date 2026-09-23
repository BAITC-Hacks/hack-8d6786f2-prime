# Сборка Windows приложения

Основной воспроизводимый путь из GitHub — установка по README. Дополнительно команда может собрать ZIP с Start.exe; готовый архив передаётся отдельно или прикладывается к релизу. Исходники GitHub Download ZIP не содержат EXE.

Windows x64: установите зависимости backend, соберите frontend, затем из корня:

```powershell
.\.venv\Scripts\python.exe -m pip install -r packaging/requirements.txt
.\.venv\Scripts\python.exe scripts/build_windows.py
.\.venv\Scripts\python.exe scripts/verify_windows.py release/SatContractors-Windows.zip --browser
```

При уже существующей сборке используйте `--output release/new-build`. Сборщик не перезаписывает готовые результаты. ZIP содержит Start.exe, встроенный Python, библиотеки, frontend и исходный CSV; локальные .env и базы исключены.

Организатор распаковывает весь архив, сохраняя _internal, и запускает Start.exe. Python/Node для запуска EXE не нужны. Сайт: http://127.0.0.1:8765. Закрытие окна или Ctrl+C останавливает сервер. Если порт занят: `Start.exe --port 8766`.

Каталог и локальная конфигурация хранятся в %LOCALAPPDATA%/SatContractors; `--data-dir <новая-папка>` задаёт отдельный чистый каталог. При первом запуске создаётся конфигурация без ключей. Для живого AI заполните OPENAI_API_KEY и перезапустите. Административного токена и панели в этой версии нет.

Verifier запускает EXE из папки с пробелом и кириллицей с PATH без Python и Node, проверяет сайт, API, закрытость частных файлов и повторный запуск без CSV. `--browser` дополнительно проверяет настоящий подбор и альтернативы; Node нужен только для запуска этих проверок.
