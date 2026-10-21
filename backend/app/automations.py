"""What the dashboard knows about its automations: when each last ran, and whether that is late.

Nothing here schedules anything. Push jobs run externally (scripts/ or a GitHub Action) and the
dashboard only sees their reports. `expected_hours` is the cadence we expect, used purely to
flag a job as stale and to estimate its next run; adjust it here if a job's real schedule differs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from . import ci_events, health_history, metrics_store, second_brain_store

# (id, name, push_runs source, expected_hours)
_PUSH_JOBS = (
    ("claude-usage", "Claude usage push", "claude", 2.0),
    ("codex-usage", "Codex usage push", "codex", 2.0),
    ("neon-usage", "Neon usage push", "neon", 26.0),
    ("fly-costs", "Fly cost push", "fly", 26.0),
    ("project-status", "Project status push", "projects", 2.0),
)
_RUN_SOURCES = {id_: source for id_, _, source, _ in _PUSH_JOBS} | {
    "second-brain": "second-brain", "personal-refresh": "personal-refresh",
}


def _age_hours(iso: str, now: datetime) -> float:
    return (now - datetime.fromisoformat(iso)).total_seconds() / 3600


def _row(
    id_: str, name: str, kind: str, detail: str, last: Optional[str], expected: Optional[float],
    now: datetime, failure: Optional[tuple[str, str]] = None,
) -> dict[str, Any]:
    """`failure` is (when, short message) of the most recent failed run, if any."""
    failure_at, error = failure or (None, None)
    if failure_at and (last is None or failure_at > last):
        status = "failing"
    elif last is None:
        status = "never"
    elif expected is not None and _age_hours(last, now) > expected:
        status = "stale"
    else:
        status = "ok"
    next_at = overdue = None
    if last is not None and expected is not None:
        next_dt = datetime.fromisoformat(last) + timedelta(hours=expected)
        next_at = next_dt.isoformat()
        overdue = round(max(0.0, (now - next_dt).total_seconds() / 3600), 1)
    return {
        "id": id_, "name": name, "kind": kind, "detail": detail,
        "last_run_at": last, "expected_hours": expected, "status": status,
        "next_expected_at": next_at, "overdue_hours": overdue,
        "last_error": error, "last_error_at": failure_at,
    }


def _push_failure(source: str) -> Optional[tuple[str, str]]:
    row = metrics_store.last_failure(source)
    return (row["ran_at"], row["error"] or "failed") if row else None


def _ci_failure() -> Optional[tuple[str, str]]:
    # ponytail: scans the latest 50 events; a failure older than that is not "last" anyway.
    for event in ci_events.list_events(limit=50):
        if event["ci_status"] == "failure":
            return event["received_at"], f"{event['repo']}: {event['details'] or 'CI failure'}"
    return None


def snapshot(poll_interval_seconds: float, now: Optional[datetime] = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    rows = []
    for id_, name, source, expected in _PUSH_JOBS:
        stored = metrics_store.load(source)
        rows.append(_row(
            id_, name, "push", "scripts/ via /internal/metrics",
            stored["reported_at"] if stored else None, expected, now, _push_failure(source),
        ))
    brain = second_brain_store.summary()
    rows.append(_row(
        "second-brain", "Second brain sync", "push", "scripts/second_brain_push.py",
        brain["pushed_at"] if brain else None, 26.0, now, _push_failure("second-brain"),
    ))
    refresh = metrics_store.load("personal-refresh")
    # Hourly 06:00-24:00 Chicago; 7h so the overnight gap is not flagged stale.
    rows.append(_row(
        "personal-refresh", "Personal feeds refresh", "push",
        "cron-job.org via /internal/personal/refresh",
        refresh["reported_at"] if refresh else None, 7.0, now, _push_failure("personal-refresh"),
    ))
    events = ci_events.list_events(limit=1)
    rows.append(_row(
        "ci-events", "CI event reports", "event", "GitHub Actions daily workflow",
        events[0]["received_at"] if events else None, 26.0, now, _ci_failure(),
    ))
    if poll_interval_seconds > 0:
        last = health_history.latest()
        rows.append(_row(
            "health-poll", "Health poller", "poller",
            f"in-process, every {poll_interval_seconds:g}s",
            last, poll_interval_seconds * 3 / 3600, now,
        ))
    else:
        rows.append({
            **_row("health-poll", "Health poller", "poller",
                   "disabled (HEALTH_POLL_INTERVAL_SECONDS=0)", None, None, now),
            "status": "disabled",
        })
    return rows


def runs(automation_id: str, limit: int = 30) -> Optional[list[dict[str, Any]]]:
    """Recent runs, newest first, or None for an unknown id. The poller keeps no run log."""
    if automation_id in _RUN_SOURCES:
        return [
            {"ran_at": r["ran_at"], "ok": bool(r["ok"]), "detail": r["error"] or ""}
            for r in metrics_store.list_runs(_RUN_SOURCES[automation_id], limit)
        ]
    if automation_id == "ci-events":
        return [
            {
                "ran_at": e["received_at"], "ok": e["ci_status"] != "failure",
                "detail": f"{e['repo']}: {e['ci_status']}"
                + (f" — {e['details']}" if e["details"] else ""),
            }
            for e in ci_events.list_events(limit=limit)
        ]
    if automation_id == "health-poll":
        return []
    return None
