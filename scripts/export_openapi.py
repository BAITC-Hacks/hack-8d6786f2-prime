"""Export the actual FastAPI schema, without loading secrets or a production database."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.application import create_app
from backend.explainer import Settings


def main():
    with tempfile.TemporaryDirectory() as temporary:
        app = create_app(db_path=Path(temporary) / "catalog.sqlite3", settings=Settings())
        schema = json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
    target = ROOT / "contracts/openapi.json"
    if "--check" in sys.argv:
        if not target.exists() or target.read_text(encoding="utf-8") != schema:
            raise SystemExit("OpenAPI is stale: run python scripts/export_openapi.py and pnpm --dir frontend api:generate")
    else:
        target.write_text(schema, encoding="utf-8")


if __name__ == "__main__":
    main()
