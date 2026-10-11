"""Per-app health check history (time series behind uptime, latency and trends).

Same persistence shape as incidents.py / ci_events.py: raw sqlite3 on a Fly
volume. One row per *fresh* check (cached dashboard responses are not
recorded). Rows older than the retention window are pruned at most hourly.
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Iterator, Literal, Optional

from .schemas import CheckResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    state TEXT NOT NULL,
    response_ms REAL,
    http_status INTEGER,
    readiness TEXT,
    provider_state TEXT,
    page_state TEXT,
    metrics_state TEXT
);
CREATE INDEX IF NOT EXISTS ix_health_checks_app_checked
    ON health_checks (app_id, checked_at);
"""

Range = Literal["24h", "7d", "30d"]
RANGES: dict[str, tuple[timedelta, int]] = {
    # range -> (window, bucket seconds for the returned points)
    "24h": (timedelta(hours=24), 300),
    "7d": (timedelta(days=7), 1800),
    "30d": (timedelta(days=30), 7200),
}
# Worst state wins when several checks fall in one bucket.
_SEVERITY = ["down", "degraded", "slow", "stale", "up", "unavailable"]
_FAILING = ("down", "degraded")
_PRUNE_EVERY_SECONDS = 3600

_db_path: str = "./aisaac_health.db"
_retention_days: float = 30.0
_last_prune: float = float("-inf")


def configure(db_path: str, retention_days: float = 30.0) -> None:
    global _db_path, _retention_days, _last_prune
    _db_path = db_path
    _retention_days = retention_days
    _last_prune = float("-inf")
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


def record(results: Iterable[CheckResult]) -> None:
    rows = [
        (
            r.app_id,
            r.checked_at.astimezone(timezone.utc).isoformat(),
            r.state,
            r.response_ms,
            r.http_status,
            r.readiness,
            r.provider_state,
            r.page_state,
            r.metrics_state,
        )
        for r in results
    ]
    with _connect() as conn:
        conn.executemany(
            "INSERT INTO health_checks (app_id, checked_at, state, response_ms, http_status,"
            " readiness, provider_state, page_state, metrics_state) VALUES (?,?,?,?,?,?,?,?,?)",
            rows,
        )
    _prune_if_due()


def _prune_if_due() -> None:
    global _last_prune
    if time.monotonic() - _last_prune < _PRUNE_EVERY_SECONDS:
        return
    _last_prune = time.monotonic()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_retention_days)).isoformat()
    with _connect() as conn:
        conn.execute("DELETE FROM health_checks WHERE checked_at < ?", (cutoff,))


def latest() -> Optional[str]:
    """Timestamp of the most recent recorded check, any app."""
    with _connect() as conn:
        return conn.execute("SELECT MAX(checked_at) FROM health_checks").fetchone()[0]


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]


def history(app_id: str, range_: Range = "24h", now: datetime | None = None) -> dict[str, Any]:
    """Summary plus bucketed points for one app over the window.

    Uptime = non-failing checks / all checks except `unavailable` (not
    configured). "Failing" matches incident logic: down and degraded; slow
    and stale are non-failing.
    """
    window, bucket_seconds = RANGES[range_]
    now = now or datetime.now(timezone.utc)
    since = (now - window).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT checked_at, state, response_ms FROM health_checks"
            " WHERE app_id = ? AND checked_at >= ? ORDER BY checked_at",
            (app_id, since),
        ).fetchall()

    counted = [r for r in rows if r["state"] != "unavailable"]
    failing = sum(1 for r in counted if r["state"] in _FAILING)
    latencies = [r["response_ms"] for r in rows if r["response_ms"] is not None]
    summary = {
        "checks": len(rows),
        "uptime_pct": round(100 * (len(counted) - failing) / len(counted), 2) if counted else None,
        "avg_response_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "p95_response_ms": round(_p95(latencies), 1) if latencies else None,
        "last_state": rows[-1]["state"] if rows else None,
        "last_checked_at": rows[-1]["checked_at"] if rows else None,
    }

    buckets: dict[int, list[sqlite3.Row]] = {}
    for r in rows:
        ts = int(datetime.fromisoformat(r["checked_at"]).timestamp())
        buckets.setdefault(ts - ts % bucket_seconds, []).append(r)
    points = []
    for start in sorted(buckets):
        group = buckets[start]
        ms = [r["response_ms"] for r in group if r["response_ms"] is not None]
        points.append(
            {
                "t": datetime.fromtimestamp(start, timezone.utc).isoformat(),
                "state": min((r["state"] for r in group), key=_SEVERITY.index),
                "response_ms": round(sum(ms) / len(ms), 1) if ms else None,
            }
        )
    return {"app_id": app_id, "range": range_, "summary": summary, "points": points}
