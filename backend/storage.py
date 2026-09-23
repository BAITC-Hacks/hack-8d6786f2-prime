"""Read-only SQL catalog. CSV is imported once; existing databases remain readable."""
import sqlite3
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from threading import Lock

from .catalog import Catalog, Contractor

RELATIONS = {"categories": "profile_categories", "event_formats": "profile_formats",
             "languages": "profile_languages", "busy_dates": "profile_busy_dates"}


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path, seed: Catalog | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=10)) as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise ValueError("Unsupported database schema version")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            schema = """
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS vocabulary (
                    kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, value));
                CREATE TABLE IF NOT EXISTS profiles (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL,
                    price_from_kzt INTEGER NOT NULL CHECK(price_from_kzt > 0),
                    max_hours REAL CHECK(max_hours IS NULL OR max_hours > 0),
                    description TEXT NOT NULL,
                    synthetic INTEGER NOT NULL CHECK(synthetic IN (0, 1)),
                    price_imputed INTEGER NOT NULL CHECK(price_imputed IN (0, 1)),
                    city_imputed INTEGER NOT NULL CHECK(city_imputed IN (0, 1)),
                    status TEXT NOT NULL DEFAULT 'approved',
                    source TEXT NOT NULL DEFAULT 'dataset',
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS profiles_status ON profiles(status, created_at, id);
            """
            for table in RELATIONS.values():
                schema += f"""CREATE TABLE IF NOT EXISTS {table} (
                    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                    value TEXT NOT NULL, PRIMARY KEY(profile_id, value));"""
            conn.executescript(schema + "PRAGMA user_version=1; COMMIT;")
        with self.connection(write=True) as conn:
            if conn.execute("SELECT value FROM metadata WHERE key='seed_version'").fetchone() is None:
                # An initialized database is independent of the original import file.
                seed = seed if isinstance(seed, Catalog) else Catalog(Path(seed))
                for kind in ("cities", "categories", "event_types", "languages"):
                    conn.executemany("INSERT INTO vocabulary(kind,value) VALUES (?,?)",
                                     [(kind, value) for value in getattr(seed, kind)])
                for record in seed.records:
                    payload = {**vars(record), "busy_dates": sorted(day.isoformat() for day in record.busy_dates)}
                    self._insert(conn, record.id, payload)
                conn.execute("INSERT INTO metadata(key,value) VALUES ('seed_version',?)", (seed.version,))
        self._refresh_lock = Lock()
        self._snapshot = self._read_snapshot()

    @contextmanager
    def connection(self, write=False):
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _insert(conn, profile_id, payload):
        timestamp = now()
        conn.execute("""INSERT INTO profiles
            (id,name,city,price_from_kzt,max_hours,description,synthetic,price_imputed,
             city_imputed,status,source,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (profile_id, payload["name"], payload["city"], payload["price_from_kzt"], payload["max_hours"],
             payload["description"], int(payload["synthetic"]),
             int(payload.get("price_imputed", False)), int(payload.get("city_imputed", False)),
             "approved", "dataset", timestamp, timestamp))
        for field, table in RELATIONS.items():
            conn.executemany(f"INSERT INTO {table}(profile_id,value) VALUES (?,?)",
                             [(profile_id, str(value)) for value in payload[field]])

    @staticmethod
    def _hydrate(conn, rows):
        items = [dict(row) for row in rows]
        by_id = {item["id"]: item for item in items}
        ids = list(by_id)
        for item in items:
            for flag in ("synthetic", "price_imputed", "city_imputed"):
                item[flag] = bool(item[flag])
            for field in RELATIONS:
                item[field] = []
        for field, table in RELATIONS.items():
            for start in range(0, len(ids), 400):
                subset = ids[start:start + 400]
                placeholders = ",".join("?" for _ in subset)
                rows = conn.execute(f"SELECT profile_id,value FROM {table} WHERE profile_id IN ({placeholders}) ORDER BY value", subset)
                for row in rows:
                    by_id[row["profile_id"]][field].append(row["value"])
        return items

    @staticmethod
    def _vocabulary(conn):
        result = {kind: [] for kind in ("cities", "categories", "event_types", "languages")}
        for row in conn.execute("SELECT kind,value FROM vocabulary ORDER BY value"):
            result[row["kind"]].append(row["value"])
        return result

    def snapshot(self):
        """Read-only requests share one version, without SQL or hashing on their path."""
        return self._snapshot

    def refresh(self):
        """Explicit atomic reload after a committed local database update; no public write API."""
        with self._refresh_lock:
            snapshot = self._read_snapshot()
            self._snapshot = snapshot
            return snapshot

    def _read_snapshot(self):
        with self.connection() as conn:
            items = self._hydrate(conn, conn.execute("SELECT id,name,city,price_from_kzt,max_hours,description,synthetic,price_imputed,city_imputed "
                                                     "FROM profiles WHERE status='approved' ORDER BY id").fetchall())
            records = [Contractor(id=item["id"], name=item["name"], city=item["city"],
                                  categories=tuple(item["categories"]), event_formats=tuple(item["event_formats"]),
                                  languages=tuple(item["languages"]), busy_dates=frozenset(date.fromisoformat(d) for d in item["busy_dates"]),
                                  price_from_kzt=item["price_from_kzt"], max_hours=item["max_hours"],
                                  description=item["description"], synthetic=item["synthetic"],
                                  price_imputed=item["price_imputed"], city_imputed=item["city_imputed"])
                       for item in items]
            return Catalog.from_records(records, self._vocabulary(conn))
