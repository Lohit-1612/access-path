import urllib.request
import urllib.parse
import json
import os
import sqlite3
from pathlib import Path

NEON_CONN_STR = os.getenv(
    "NEON_DATABASE_URL",
    "postgresql://neondb_owner:npg_E05shINcnYWH@ep-winter-thunder-b53c0oip.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"
)

parsed = urllib.parse.urlparse(NEON_CONN_STR)
NEON_SQL_URL = f"https://{parsed.hostname}/sql"

def execute_neon_sql(query: str, params: list = None):
    headers = {
        "Neon-Connection-String": NEON_CONN_STR,
        "Neon-Raw-Text-Output": "true",
        "Neon-Array-Mode": "false",
        "Content-Type": "application/json"
    }
    payload = {"query": query}
    if params:
        payload["params"] = params
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(NEON_SQL_URL, data=data, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def init_neon_schema():
    print("Initialising schema on Neon PostgreSQL...")
    ddl_statements = [
        """CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lon DOUBLE PRECISION NOT NULL,
            level INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            lat DOUBLE PRECISION NOT NULL,
            lon DOUBLE PRECISION NOT NULL,
            entrance_node_ids TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            name TEXT,
            from_id TEXT NOT NULL REFERENCES nodes(id),
            to_id TEXT NOT NULL REFERENCES nodes(id),
            geom TEXT NOT NULL,
            length_m DOUBLE PRECISION NOT NULL,
            stairs INTEGER DEFAULT 0,
            width_m DOUBLE PRECISION,
            slope_pct DOUBLE PRECISION,
            roughness DOUBLE PRECISION DEFAULT 0.0,
            crossing_type TEXT,
            surface TEXT DEFAULT 'paved',
            checked_at TEXT,
            source TEXT DEFAULT 'survey'
        )""",
        """CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            reporter_id TEXT REFERENCES users(id),
            category TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            lat DOUBLE PRECISION NOT NULL,
            lon DOUBLE PRECISION NOT NULL,
            accuracy_m DOUBLE PRECISION DEFAULT 5.0,
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
        """CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            box_x1 DOUBLE PRECISION NOT NULL,
            box_y1 DOUBLE PRECISION NOT NULL,
            box_x2 DOUBLE PRECISION NOT NULL,
            box_y2 DOUBLE PRECISION NOT NULL,
            label TEXT NOT NULL,
            raw_score DOUBLE PRECISION NOT NULL,
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

    for stmt in ddl_statements:
        execute_neon_sql(stmt)
    print("Schema initialised successfully on Neon!")

def sync_sqlite_to_neon():
    init_neon_schema()
    sqlite_db_path = Path(__file__).resolve().parent.parent / "accesspath.db"
    if not sqlite_db_path.exists():
        print(f"No local sqlite db found at {sqlite_db_path}")
        return

    print(f"Syncing data from local SQLite ({sqlite_db_path}) to Neon PostgreSQL...")
    conn = sqlite3.connect(str(sqlite_db_path))
    conn.row_factory = sqlite3.Row

    # Clear target tables on Neon in proper foreign key order
    clear_tables = ["detections", "media", "reviews", "report_edges", "reports", "jobs", "edges", "places", "nodes", "events", "graph_state", "users"]
    for tbl in clear_tables:
        execute_neon_sql(f"DELETE FROM {tbl};")

    tables = ["users", "nodes", "places", "edges", "reports", "report_edges", "media", "detections", "jobs", "reviews", "graph_state", "events"]

    for table in tables:
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        if not rows:
            continue
        cols = list(rows[0].keys())
        cols_str = ", ".join(cols)

        # Batch insert into Neon
        print(f"  Syncing table '{table}': {len(rows)} rows...")
        # Format batch VALUES
        chunk_size = 50
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i+chunk_size]
            values_clauses = []
            for r in chunk:
                escaped_vals = []
                for c in cols:
                    val = r[c]
                    if val is None:
                        escaped_vals.append("NULL")
                    elif isinstance(val, (int, float)):
                        escaped_vals.append(str(val))
                    else:
                        # Escape single quotes for SQL string literal
                        escaped = str(val).replace("'", "''")
                        escaped_vals.append(f"'{escaped}'")
                values_clauses.append(f"({', '.join(escaped_vals)})")
            
            insert_sql = f"INSERT INTO {table} ({cols_str}) VALUES {', '.join(values_clauses)};"
            execute_neon_sql(insert_sql)

    conn.close()
    print("ALL TABLES AND BENCHMARK DATA SYNCED TO NEON POSTGRESQL SUCCESSFULLY!")

if __name__ == "__main__":
    sync_sqlite_to_neon()
