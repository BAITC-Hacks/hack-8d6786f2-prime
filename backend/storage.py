"""Persistent, transactional SQL storage. CSV is only a first-run seed."""
import hashlib
import json
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from .catalog import Catalog, Contractor
from .profiles import ProfileInput

RELATIONS = {"categories": "profile_categories", "event_formats": "profile_formats",
             "languages": "profile_languages", "busy_dates": "profile_busy_dates"}


class StoreConflict(Exception):
    pass


class StoreMissing(Exception):
    pass


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
                    description TEXT NOT NULL, contact_email TEXT,
                    synthetic INTEGER NOT NULL CHECK(synthetic IN (0, 1)),
                    price_imputed INTEGER NOT NULL CHECK(price_imputed IN (0, 1)),
                    city_imputed INTEGER NOT NULL CHECK(city_imputed IN (0, 1)),
                    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
                    source TEXT NOT NULL CHECK(source IN ('dataset','application','admin')),
                    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    moderation_note TEXT NOT NULL DEFAULT '', fingerprint TEXT UNIQUE);
                CREATE INDEX IF NOT EXISTS profiles_status ON profiles(status, created_at, id);
                CREATE TABLE IF NOT EXISTS audit_log (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
                    action TEXT NOT NULL, created_at TEXT NOT NULL);
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
                    payload = {**vars(record), "busy_dates": sorted(day.isoformat() for day in record.busy_dates),
                               "contact_email": None}
                    self._insert(conn, record.id, payload, "approved", "dataset", None)
                conn.execute("INSERT INTO metadata(key,value) VALUES ('seed_version',?)", (seed.version,))

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
    def _insert(conn, profile_id, payload, status, source, fingerprint):
        timestamp = now()
        conn.execute("""INSERT INTO profiles
            (id,name,city,price_from_kzt,max_hours,description,contact_email,synthetic,price_imputed,
             city_imputed,status,source,created_at,updated_at,fingerprint)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (profile_id, payload["name"], payload["city"], payload["price_from_kzt"], payload["max_hours"],
             payload["description"], payload["contact_email"], int(payload["synthetic"]),
             int(payload.get("price_imputed", False)), int(payload.get("city_imputed", False)),
             status, source, timestamp, timestamp, fingerprint))
        for field, table in RELATIONS.items():
            conn.executemany(f"INSERT INTO {table}(profile_id,value) VALUES (?,?)",
                             [(profile_id, str(value)) for value in payload[field]])

    @staticmethod
    def _hydrate(conn, rows):
        items = [dict(row) for row in rows]
        by_id = {item["id"]: item for item in items}
        ids = list(by_id)
        for item in items:
            item.pop("fingerprint", None)
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

    def vocabulary(self):
        with self.connection() as conn:
            return self._vocabulary(conn)

    def snapshot(self):
        with self.connection() as conn:
            items = self._hydrate(conn, conn.execute("SELECT * FROM profiles WHERE status='approved' ORDER BY id").fetchall())
            records = [Contractor(id=item["id"], name=item["name"], city=item["city"],
                                  categories=tuple(item["categories"]), event_formats=tuple(item["event_formats"]),
                                  languages=tuple(item["languages"]), busy_dates=frozenset(date.fromisoformat(d) for d in item["busy_dates"]),
                                  price_from_kzt=item["price_from_kzt"], max_hours=item["max_hours"],
                                  description=item["description"], synthetic=item["synthetic"],
                                  price_imputed=item["price_imputed"], city_imputed=item["city_imputed"])
                       for item in items]
            return Catalog.from_records(records, self._vocabulary(conn))

    def list_profiles(self, status="all", limit=50, offset=0):
        with self.connection() as conn:
            counts = {state: 0 for state in ("pending", "approved", "rejected")}
            for row in conn.execute("SELECT status,COUNT(*) AS count FROM profiles GROUP BY status"):
                counts[row["status"]] = row["count"]
            if status == "all":
                total = sum(counts.values())
                rows = conn.execute("SELECT * FROM profiles ORDER BY created_at DESC,id LIMIT ? OFFSET ?", (limit, offset)).fetchall()
            else:
                total = counts[status]
                rows = conn.execute("SELECT * FROM profiles WHERE status=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?", (status, limit, offset)).fetchall()
            return {"items": self._hydrate(conn, rows), "total": total, "limit": limit,
                    "offset": offset, "counts": counts, "storage": "sqlite"}

    @classmethod
    def _get(cls, conn, profile_id):
        row = conn.execute("SELECT * FROM profiles WHERE id=?", (profile_id,)).fetchone()
        if row is None:
            raise StoreMissing("Анкета не найдена")
        return cls._hydrate(conn, [row])[0]

    def create(self, profile: ProfileInput, *, admin=False):
        payload = profile.model_dump(mode="json")
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        profile_id = "USR-" + uuid.uuid4().hex
        with self.connection(write=True) as conn:
            try:
                self._insert(conn, profile_id, payload, "approved" if admin else "pending",
                             "admin" if admin else "application", fingerprint)
            except sqlite3.IntegrityError as exc:
                if "profiles.fingerprint" in str(exc):
                    raise StoreConflict("Такая анкета уже отправлена. Повторная отправка не требуется.") from None
                raise
            conn.execute("INSERT INTO audit_log(profile_id,action,created_at) VALUES (?,?,?)",
                         (profile_id, "admin_create" if admin else "submit", now()))
            return self._get(conn, profile_id)

    def moderate(self, profile_id, decision, expected_revision, note):
        with self.connection(write=True) as conn:
            item = self._get(conn, profile_id)
            if item["revision"] != expected_revision:
                raise StoreConflict("Анкета уже изменена. Обновите список и повторите действие.")
            if item["status"] == decision:
                raise StoreConflict("Этот статус уже установлен.")
            if decision == "approved" and item["source"] != "dataset":
                try:
                    ProfileInput.model_validate({field: item[field] for field in ProfileInput.model_fields})
                except ValidationError:
                    raise StoreConflict("Анкета не соответствует текущим правилам заполнения. "
                                        "Нужно подать исправленную анкету перед одобрением.") from None
            conn.execute("UPDATE profiles SET status=?,revision=revision+1,moderation_note=?,updated_at=? WHERE id=?",
                         (decision, note, now(), profile_id))
            conn.execute("INSERT INTO audit_log(profile_id,action,created_at) VALUES (?,?,?)",
                         (profile_id, decision, now()))
            return self._get(conn, profile_id)

    def delete(self, profile_id, expected_revision):
        with self.connection(write=True) as conn:
            item = self._get(conn, profile_id)
            if item["revision"] != expected_revision:
                raise StoreConflict("Анкета уже изменена. Обновите список перед удалением.")
            conn.execute("DELETE FROM profiles WHERE id=?", (profile_id,))
            conn.execute("INSERT INTO audit_log(profile_id,action,created_at) VALUES (?,?,?)", (profile_id, "delete", now()))
