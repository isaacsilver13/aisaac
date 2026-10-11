"""Latest pushed snapshot per financial/usage source (claude, neon, fly).

Same SQLite-on-a-Fly-volume pattern as incidents.py. Only the most recent
payload per source is kept: these are point-in-time figures pushed by
external jobs, and the app never holds provider credentials itself.

`push_runs` is a separate append-only log of each push attempt (time, ok, short error
code; never the payload), kept for 30 days so the Automations page can show run history.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_snapshots (
    source TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    reported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    ran_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS ix_push_runs_source ON push_runs (source, ran_at);
"""

RUN_RETENTION_DAYS = 30

_db_path: str = "./aisaac_metrics.db"


def configure(db_path: str) -> None:
    global _db_path
    _db_path = db_path
    with _connect() as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def save(source: str, payload_json: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO metric_snapshots (source, payload, reported_at) VALUES (?, ?, ?) "
            "ON CONFLICT(source) DO UPDATE SET payload = excluded.payload, "
            "reported_at = excluded.reported_at",
            (source, payload_json, datetime.now(timezone.utc).isoformat()),
        )
    record_run(source, ok=True)


def record_run(source: str, ok: bool, error: Optional[str] = None) -> None:
    """Log one push attempt; `error` is a short code, never a payload or provider message."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=RUN_RETENTION_DAYS)).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO push_runs (source, ran_at, ok, error) VALUES (?, ?, ?, ?)",
            (source, now.isoformat(), int(ok), error),
        )
        conn.execute("DELETE FROM push_runs WHERE source = ? AND ran_at < ?", (source, cutoff))


def list_runs(source: str, limit: int = 30) -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT ran_at, ok, error FROM push_runs WHERE source = ? "
            "ORDER BY ran_at DESC, id DESC LIMIT ?",
            (source, limit),
        ).fetchall()


def last_failure(source: str) -> Optional[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT ran_at, error FROM push_runs WHERE source = ? AND ok = 0 "
            "ORDER BY ran_at DESC, id DESC LIMIT 1",
            (source,),
        ).fetchone()


def load(source: str) -> Optional[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT payload, reported_at FROM metric_snapshots WHERE source = ?", (source,)
        ).fetchone()
