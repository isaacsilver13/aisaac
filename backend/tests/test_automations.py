from datetime import datetime, timedelta, timezone

from app import automations, ci_events, health_history, metrics_store, second_brain_store

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def _by_id(rows):
    return {r["id"]: r for r in rows}


def test_snapshot_flags_never_ok_stale_and_disabled(tmp_path, monkeypatch):
    metrics_store.configure(str(tmp_path / "m.db"))
    second_brain_store.configure(str(tmp_path / "s.db"))
    ci_events.configure(str(tmp_path / "c.db"))
    health_history.configure(str(tmp_path / "h.db"))

    rows = _by_id(automations.snapshot(0, now=NOW))
    assert rows["claude-usage"]["status"] == "never"
    assert rows["codex-usage"]["status"] == "never"
    assert rows["health-poll"]["status"] == "disabled"
    assert rows["ci-events"]["status"] == "never"
    assert rows["ci-events"]["expected_hours"] == 26.0

    class Fresh(dict):
        pass

    def fake_load(source):
        age = {"claude": timedelta(hours=1), "neon": timedelta(hours=40)}.get(source)
        return {"reported_at": (NOW - age).isoformat()} if age else None

    monkeypatch.setattr(metrics_store, "load", fake_load)
    rows = _by_id(automations.snapshot(0, now=NOW))
    assert rows["claude-usage"]["status"] == "ok"
    assert rows["neon-usage"]["status"] == "stale"  # 40h > 26h
    assert rows["fly-costs"]["status"] == "never"


def test_poller_enabled_reads_latest_check(tmp_path):
    health_history.configure(str(tmp_path / "h.db"))
    assert _by_id(automations.snapshot(60, now=NOW))["health-poll"]["status"] == "never"


def test_ci_reports_become_stale_after_daily_freshness_window(tmp_path, monkeypatch):
    ci_events.configure(str(tmp_path / "c.db"))
    monkeypatch.setattr(ci_events, "_now", lambda: (NOW - timedelta(hours=27)).isoformat())
    ci_events.record_event(
        "vinyl", "isaacsilver13/vinyl", "status_report", "success", "all clear", False
    )

    rows = _by_id(automations.snapshot(0, now=NOW))

    assert rows["ci-events"]["status"] == "stale"


def test_next_run_overdue_and_failure_details(tmp_path, monkeypatch):
    metrics_store.configure(str(tmp_path / "m.db"))
    second_brain_store.configure(str(tmp_path / "s.db"))
    ci_events.configure(str(tmp_path / "c.db"))
    health_history.configure(str(tmp_path / "h.db"))
    metrics_store.save("neon", "{}")
    metrics_store.record_run("fly", ok=False, error="invalid_payload")
    ci_events.record_event("vinyl", "isaacsilver13/vinyl", "status_report", "failure", "red", False)
    ci_events.record_event("vinyl", "isaacsilver13/vinyl", "status_report", "success", "", False)

    later = datetime.now(timezone.utc) + timedelta(hours=30)
    rows = _by_id(automations.snapshot(0, now=later))

    neon = rows["neon-usage"]
    assert neon["status"] == "stale"
    assert 3.9 <= neon["overdue_hours"] <= 4.1  # 30h since run, 26h cadence
    assert neon["next_expected_at"] > neon["last_run_at"]
    assert rows["fly-costs"]["status"] == "failing"
    assert rows["fly-costs"]["last_error"] == "invalid_payload"
    # A CI failure is reported as a detail, but the reporter itself is still running.
    assert rows["ci-events"]["last_error"] == "isaacsilver13/vinyl: red"
    assert rows["ci-events"]["status"] == "stale"
    assert rows["health-poll"]["next_expected_at"] is None


def test_runs_lists_push_and_ci_history(tmp_path):
    metrics_store.configure(str(tmp_path / "m.db"))
    ci_events.configure(str(tmp_path / "c.db"))
    metrics_store.record_run("claude", ok=False, error="invalid_payload")
    metrics_store.save("claude", "{}")
    ci_events.record_event("gym-tracker", "o/gym", "status_report", "failure", "boom", False)

    claude = automations.runs("claude-usage")
    assert [r["ok"] for r in claude] == [True, False]
    assert claude[1]["detail"] == "invalid_payload"
    assert automations.runs("ci-events") == [
        {"ran_at": automations.runs("ci-events")[0]["ran_at"], "ok": False,
         "detail": "o/gym: failure — boom"},
    ]
    assert automations.runs("health-poll") == []
    assert automations.runs("nope") is None
