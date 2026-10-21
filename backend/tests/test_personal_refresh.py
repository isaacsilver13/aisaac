import asyncio

import httpx
import pytest

from app import (
    automations,
    main,
    metrics_store,
    personal_calendar,
    personal_news,
    personal_own,
    personal_shoes,
    personal_sports,
    personal_store,
)

SECRET = {"X-Internal-Secret": "secret"}
READ = {"X-Dashboard-Token": "read"}


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    metrics_store.configure(str(tmp_path / "m.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")
    monkeypatch.setattr(main.settings, "google_calendar_ics_url", "https://calendar.test/x.ics")
    calls = []
    monkeypatch.setattr(personal_news, "refresh", lambda: calls.append("news"))
    monkeypatch.setattr(personal_sports, "refresh", lambda: calls.append("sports") or "ok")
    monkeypatch.setattr(
        personal_shoes, "refresh", lambda: calls.append("shoes") or "not_configured"
    )
    monkeypatch.setattr(personal_own, "refresh", lambda key: calls.append("own") or {"ebay": "ok"})
    monkeypatch.setattr(
        personal_calendar, "today",
        lambda url, now: calls.append("calendar") or {"state": "ok", "events": []},
    )
    return calls


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def _row(id_):
    return next(r for r in automations.snapshot(0) if r["id"] == id_)


def test_refresh_needs_internal_secret(configured):
    assert _request("POST", "/internal/personal/refresh").status_code == 401
    bad = {"X-Internal-Secret": "nope"}
    assert _request("POST", "/internal/personal/refresh", headers=bad).status_code == 401
    assert configured == []


def test_refresh_runs_every_source_and_stores_the_brief(configured):
    r = _request("POST", "/internal/personal/refresh", headers=SECRET)
    assert r.json() == {
        "news": "ok", "sports": "ok", "shoes": "not_configured", "own": "ok", "assistant": "ok",
    }
    assert configured == ["news", "sports", "shoes", "own", "calendar"]  # brief last
    assert personal_store.load_brief()["calendar"]["state"] == "ok"
    assert _row("personal-refresh")["status"] == "ok"


def test_one_failing_source_does_not_stop_the_others(configured, monkeypatch):
    def boom():
        raise RuntimeError("upstream said something secret")

    monkeypatch.setattr(personal_sports, "refresh", boom)
    r = _request("POST", "/internal/personal/refresh", headers=SECRET)
    assert r.status_code == 200
    assert r.json() == {
        "news": "ok", "sports": "error", "shoes": "not_configured", "own": "ok", "assistant": "ok",
    }
    assert "calendar" in configured and personal_store.load_brief() is not None
    run = metrics_store.list_runs("personal-refresh")[0]
    assert (run["ok"], run["error"]) == (0, "sports:error")
    assert _row("personal-refresh")["status"] == "failing"
    assert "secret" not in r.text


def test_assistant_get_serves_the_snapshot_without_fetching_the_calendar(configured):
    personal_store.save_brief({"generated_at": "stored", "calendar": {"state": "ok", "events": []}})
    r = _request("GET", "/api/v1/personal/assistant", headers=READ)
    assert r.json()["generated_at"] == "stored"
    assert configured == []


def test_assistant_get_builds_once_when_nothing_is_stored(configured):
    first = _request("GET", "/api/v1/personal/assistant", headers=READ).json()
    second = _request("GET", "/api/v1/personal/assistant", headers=READ).json()
    assert configured == ["calendar"]
    assert first == second == personal_store.load_brief()


def test_force_refresh_rebuilds_and_replaces_the_snapshot(configured):
    personal_store.save_brief({"generated_at": "stored"})
    r = _request("GET", "/api/v1/personal/assistant?force_refresh=true", headers=READ)
    assert configured == ["calendar"]
    assert r.json()["generated_at"] != "stored"
    assert personal_store.load_brief() == r.json()
