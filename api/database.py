import sqlite3
import json
import os
from pathlib import Path
from contextlib import contextmanager
from api.config import settings

DB_FILE = Path(settings.DATABASE_URL.replace("sqlite:///", ""))

def get_connection():
    conn = sqlite3.connect(str(DB_FILE), check_same_thread=False)
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
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL, -- reporter, verifier, admin
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- junction, crossing, kerb, entrance, destination
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            level INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            entrance_node_ids TEXT NOT NULL -- JSON list
        );

        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            name TEXT,
            from_id TEXT NOT NULL REFERENCES nodes(id),
            to_id TEXT NOT NULL REFERENCES nodes(id),
            geom TEXT NOT NULL, -- JSON [[lon, lat], ...]
            length_m REAL NOT NULL,
            stairs INTEGER DEFAULT 0,
            width_m REAL,
            slope_pct REAL,
            roughness REAL DEFAULT 0.0,
            crossing_type TEXT,
            surface TEXT DEFAULT 'paved',
            checked_at TEXT,
            source TEXT DEFAULT 'survey'
        );

        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            reporter_id TEXT REFERENCES users(id),
            category TEXT NOT NULL, -- stairs, construction, damaged_surface, missing_ramp, narrow_path, steep_slope, blockage
            status TEXT NOT NULL DEFAULT 'draft', -- draft, pending, verified_active, disputed, stale, resolved, rejected
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            accuracy_m REAL DEFAULT 5.0,
            observed_at TEXT NOT NULL,
            version INTEGER DEFAULT 1,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS report_edges (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
            extent TEXT DEFAULT 'complete', -- complete, partial
            direction TEXT DEFAULT 'both',
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            object_key TEXT NOT NULL,
            file_path TEXT NOT NULL,
            sha256_hash TEXT NOT NULL,
            mime_type TEXT DEFAULT 'image/jpeg',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
            box_x1 REAL NOT NULL,
            box_y1 REAL NOT NULL,
            box_x2 REAL NOT NULL,
            box_y2 REAL NOT NULL,
            label TEXT NOT NULL,
            raw_score REAL NOT NULL,
            model_revision TEXT DEFAULT 'google/owlv2-base-patch16',
            prompt TEXT NOT NULL,
            is_precomputed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            type TEXT DEFAULT 'barrier_detection',
            payload TEXT NOT NULL, -- JSON
            state TEXT DEFAULT 'queued', -- queued, running, succeeded, failed
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 3,
            lease_until TEXT,
            error TEXT,
            result TEXT, -- JSON
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            actor_id TEXT REFERENCES users(id),
            actor_name TEXT DEFAULT 'Campus Verifier',
            action TEXT NOT NULL, -- verify, dispute, reject, resolve
            reason TEXT NOT NULL,
            old_state TEXT NOT NULL,
            new_state TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS graph_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            revision INTEGER NOT NULL DEFAULT 1,
            event_id TEXT,
            affected_edge_ids TEXT DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_edges_nodes ON edges(from_id, to_id);
        CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
        CREATE INDEX IF NOT EXISTS idx_report_edges_edge ON report_edges(edge_id);
        CREATE INDEX IF NOT EXISTS idx_events_rev ON events(revision);
        """)
