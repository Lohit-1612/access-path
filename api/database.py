import sqlite3
import json
import os
import urllib.request
import urllib.parse
from pathlib import Path
from contextlib import contextmanager
from typing import Optional, List, Dict, Any
from api.config import settings

def is_postgres_url(url: str) -> bool:
    return url.startswith("postgresql://") or url.startswith("postgres://")

IS_NEON = is_postgres_url(settings.DATABASE_URL)

# --- Neon PostgreSQL Driver over HTTPS (Port 443, Zero-Dependency, Works Across All Networks) ---

class NeonRow(dict):
    """Dict-like and tuple-like row wrapper matching sqlite3.Row behavior."""
    def __init__(self, data: Dict[str, Any], cols: Optional[List[str]] = None):
        super().__init__(data)
        self._cols = cols or list(data.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return super().__getitem__(self._cols[key])
        return super().__getitem__(key)

    def keys(self):
        return self._cols

    def get(self, key, default=None):
        if isinstance(key, int):
            if 0 <= key < len(self._cols):
                return super().get(self._cols[key], default)
            return default
        return super().get(key, default)


def _cast_pg_value(val: Any, type_id: int) -> Any:
    if val is None:
        return None
    # Booleans
    if type_id == 16:
        return val in (True, "t", "true", "1")
    # Integers (INT8=20, INT2=21, INT4=23)
    if type_id in (20, 21, 23):
        try:
            return int(val)
        except (ValueError, TypeError):
            return val
    # Floating points (FLOAT4=700, FLOAT8=701, NUMERIC=1700)
    if type_id in (700, 701, 1700):
        try:
            return float(val)
        except (ValueError, TypeError):
            return val
    return val


def _escape_sql_param(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"


def _format_query_params(query: str, params: Optional[Any] = None) -> str:
    if not params:
        return query
    parts = query.split("?")
    if len(parts) - 1 != len(params):
        # Fallback if params mismatch
        return query
    out = []
    for i, p in enumerate(params):
        out.append(parts[i])
        out.append(_escape_sql_param(p))
    out.append(parts[-1])
    return "".join(out)


class NeonCursor:
    def __init__(self, rows: List[NeonRow], rowcount: int = 0):
        self._rows = rows
        self._index = 0
        self.rowcount = rowcount

    def fetchone(self) -> Optional[NeonRow]:
        if self._index < len(self._rows):
            r = self._rows[self._index]
            self._index += 1
            return r
        return None

    def fetchall(self) -> List[NeonRow]:
        remaining = self._rows[self._index:]
        self._index = len(self._rows)
        return remaining


class NeonConnection:
    def __init__(self, conn_str: str):
        self.conn_str = conn_str
        parsed = urllib.parse.urlparse(conn_str)
        self.sql_endpoint = f"https://{parsed.hostname}/sql"

    def execute(self, sql: str, params: Optional[Any] = None) -> NeonCursor:
        formatted_sql = _format_query_params(sql, params)
        headers = {
            "Neon-Connection-String": self.conn_str,
            "Neon-Raw-Text-Output": "true",
            "Neon-Array-Mode": "false",
            "Content-Type": "application/json"
        }
        req = urllib.request.Request(
            self.sql_endpoint,
            data=json.dumps({"query": formatted_sql}).encode("utf-8"),
            headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise RuntimeError(f"Neon database query failed: {e}\nSQL: {formatted_sql[:200]}") from e

        fields = data.get("fields", [])
        field_types = {f["name"]: f.get("dataTypeID", 0) for f in fields}
        cols = [f["name"] for f in fields]

        raw_rows = data.get("rows", [])
        typed_rows = []
        for r in raw_rows:
            typed_dict = {}
            for k, v in r.items():
                tid = field_types.get(k, 0)
                typed_dict[k] = _cast_pg_value(v, tid)
            typed_rows.append(NeonRow(typed_dict, cols))

        rowcount = data.get("rowCount", len(typed_rows))
        return NeonCursor(typed_rows, rowcount=rowcount)

    def executemany(self, sql: str, params_list: List[Any]) -> None:
        for p in params_list:
            self.execute(sql, p)

    def executescript(self, script: str) -> None:
        statements = [s.strip() for s in script.split(";") if s.strip()]
        for stmt in statements:
            self.execute(stmt)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


# --- Unified Database Access Layer ---

def get_connection():
    if is_postgres_url(settings.DATABASE_URL):
        return NeonConnection(settings.DATABASE_URL)
    
    db_file = Path(settings.DATABASE_URL.replace("sqlite:///", ""))
    conn = sqlite3.connect(str(db_file), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialise all tables matching Section 9 of the VH-S03 specification."""
    real_type = "DOUBLE PRECISION" if is_postgres_url(settings.DATABASE_URL) else "REAL"

    ddl_statements = [
        """CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            lat {real_type} NOT NULL,
            lon {real_type} NOT NULL,
            level INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            lat {real_type} NOT NULL,
            lon {real_type} NOT NULL,
            entrance_node_ids TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            name TEXT,
            from_id TEXT NOT NULL REFERENCES nodes(id),
            to_id TEXT NOT NULL REFERENCES nodes(id),
            geom TEXT NOT NULL,
            length_m {real_type} NOT NULL,
            stairs INTEGER DEFAULT 0,
            width_m {real_type},
            slope_pct {real_type},
            roughness {real_type} DEFAULT 0.0,
            crossing_type TEXT,
            surface TEXT DEFAULT 'paved',
            checked_at TEXT,
            source TEXT DEFAULT 'survey'
        )""",
        f"""CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            reporter_id TEXT REFERENCES users(id),
            category TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            lat {real_type} NOT NULL,
            lon {real_type} NOT NULL,
            accuracy_m {real_type} DEFAULT 5.0,
            observed_at TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS report_edges (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
            extent TEXT DEFAULT 'complete',
            direction TEXT DEFAULT 'both',
            notes TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            object_key TEXT NOT NULL,
            file_path TEXT NOT NULL,
            sha256_hash TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/jpeg',
            created_at TEXT NOT NULL
        )""",
        f"""CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            box_x1 {real_type} NOT NULL,
            box_y1 {real_type} NOT NULL,
            box_x2 {real_type} NOT NULL,
            box_y2 {real_type} NOT NULL,
            label TEXT NOT NULL,
            raw_score {real_type} NOT NULL,
            model_revision TEXT DEFAULT 'google/owlv2-base-patch16',
            prompt TEXT NOT NULL,
            is_precomputed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            type TEXT DEFAULT 'barrier_detection',
            payload TEXT NOT NULL,
            state TEXT DEFAULT 'queued',
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 3,
            lease_until TEXT,
            error TEXT,
            result TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            actor_id TEXT REFERENCES users(id),
            actor_name TEXT DEFAULT 'Campus Verifier',
            action TEXT NOT NULL,
            reason TEXT NOT NULL,
            old_state TEXT NOT NULL,
            new_state TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS graph_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            revision INTEGER NOT NULL DEFAULT 1,
            event_id TEXT,
            affected_edge_ids TEXT DEFAULT '[]',
            updated_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_edges_nodes ON edges(from_id, to_id)",
        "CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)",
        "CREATE INDEX IF NOT EXISTS idx_report_edges_edge ON report_edges(edge_id)",
        "CREATE INDEX IF NOT EXISTS idx_events_rev ON events(revision)"
    ]

    with get_db() as conn:
        for stmt in ddl_statements:
            conn.execute(stmt)
