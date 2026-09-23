"""Resolve immutable resources separately from local configuration and SQL state."""
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class RuntimePaths:
    resources: Path
    state: Path
    env_file: Path
    bundled: bool

    @classmethod
    def discover(cls):
        resources = Path(__file__).resolve().parents[1]
        bundled = bool(getattr(sys, "frozen", False))
        custom = os.getenv("SAT_DATA_DIR")
        if custom:
            state = Path(custom).expanduser().resolve()
        elif bundled:
            state = Path(os.getenv("LOCALAPPDATA") or Path.home() / ".local" / "share") / "SatContractors"
        else:
            state = resources / "data"
        env_file = state / ".env" if bundled or custom else resources / "backend" / ".env"
        return cls(resources, state, env_file, bundled)

    def configured_path(self, variable, default):
        value = os.getenv(variable)
        if not value:
            return Path(default)
        path = Path(value).expanduser()
        base = self.state if self.bundled else self.resources
        return path if path.is_absolute() else base / path

    @property
    def database(self):
        return self.configured_path("DATABASE_PATH", self.state / "catalog.sqlite3")

    @property
    def seed(self):
        return self.configured_path("CONTRACTORS_CSV", self.resources / "data" / "contractors.csv")

    @property
    def frontend(self):
        return self.configured_path("SAT_FRONTEND_DIR", self.resources / "frontend" / "dist")

    def load_environment(self):
        load_dotenv(self.env_file, override=False)
