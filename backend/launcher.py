"""One-process local launcher, shared by source checkout and Windows distribution."""
import argparse
import asyncio
import os
import secrets
import socket
import sys
import webbrowser
from pathlib import Path

import uvicorn

from .application import create_app
from .runtime import RuntimePaths


def initialize_config(paths):
    """Create a private local configuration once; never copy a developer's .env."""
    paths.env_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        with paths.env_file.open("x", encoding="utf-8") as output:
            output.write("# Local settings. Do not share this file or commit it to Git.\n"
                         "LLM_PROVIDER=openai\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-4o-mini\n"
                         "NVIDIA_API_KEY=\nNVIDIA_MODEL=\nLLM_TIMEOUT_SECONDS=6\n"
                         "ADMIN_API_TOKEN=" + secrets.token_urlsafe(32) + "\n")
    except FileExistsError:
        pass


class BrowserServer(uvicorn.Server):
    def __init__(self, config, url, open_browser):
        super().__init__(config)
        self.url = url
        self.open_browser = open_browser

    async def startup(self, sockets=None):
        await super().startup(sockets=sockets)
        if self.started and self.open_browser:
            await asyncio.to_thread(webbrowser.open, self.url)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Сәт: локальный сайт подбора подрядчиков")
    parser.add_argument("--port", type=int, default=8765, help="Локальный порт, по умолчанию 8765")
    parser.add_argument("--no-browser", action="store_true", help="Не открывать браузер автоматически")
    parser.add_argument("--data-dir", type=Path, help="Отдельная папка настроек и SQL-базы")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("Порт должен быть в диапазоне 0–65535")
    if args.data_dir is not None:
        os.environ["SAT_DATA_DIR"] = str(args.data_dir.expanduser().resolve())
    paths = RuntimePaths.discover()
    paths.load_environment()
    if not (paths.frontend / "index.html").is_file():
        parser.error("Нет сборки сайта. Выполните scripts/setup.ps1 или соберите frontend перед запуском.")
    initialize_config(paths)
    paths.load_environment()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        # A pre-bound socket gives one owner and a known URL even for --port 0 in tests.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            listener.bind(("127.0.0.1", args.port))
        except OSError:
            print("Не удалось открыть порт. Закройте предыдущий запуск или укажите другой --port.", file=sys.stderr)
            return 1
        port = listener.getsockname()[1]
        url = f"http://127.0.0.1:{port}"
        app = create_app(frontend_dir=paths.frontend)
        print(f"Сәт: {url}\nНастройки и код администратора: {paths.env_file}\n"
              f"SQL-база: {paths.database}\nДля остановки нажмите Ctrl+C в этом окне.", flush=True)
        if not app.state.explainer.settings.available:
            print("Подбор работает с базовыми объяснениями. Для ИИ заполните ключ в настройках и перезапустите.", flush=True)
        server = BrowserServer(uvicorn.Config(app, host="127.0.0.1", port=port, access_log=False,
                                            loop="asyncio", http="h11", ws="none"),
                               url, not args.no_browser)
        server.run(sockets=[listener])
    return 0


def entrypoint():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    try:
        code = main()
    except (OSError, ValueError):
        print("Не удалось запустить приложение. Проверьте доступ к папке данных и настройки .env.", file=sys.stderr)
        code = 1
    if code and getattr(sys, "frozen", False) and len(sys.argv) == 1:
        input("Нажмите Enter, чтобы закрыть окно.")
    return code
