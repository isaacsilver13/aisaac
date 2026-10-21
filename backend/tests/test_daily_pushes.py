import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from app import daily_pushes, main, notify, personal_store

MORNING = datetime(2026, 10, 21, 13, 0, tzinfo=timezone.utc)  # 08:00 CDT
EARLY = datetime(2026, 10, 21, 11, 0, tzinfo=timezone.utc)  # 06:00 CDT


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "dashboard_write_token", "write")
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")
    monkeypatch.setattr(daily_pushes, "PUSHES", {"demo": (7, lambda day: f"hello {day}")})


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def test_disabled_kind_never_sends():
    sent = []
    assert daily_pushes.run(MORNING, sent.append) == {"demo": "disabled"}
    assert sent == []


def test_enabled_kind_sends_once_per_chicago_day():
    personal_store.set_push_pref("demo", True)
    sent = []

    def send(message):
        sent.append(message)
        return True

    assert daily_pushes.run(EARLY, send) == {"demo": "not_due"}
    assert daily_pushes.run(MORNING, send) == {"demo": "sent"}
    assert daily_pushes.run(MORNING, send) == {"demo": "already_sent"}
    assert sent == ["hello 2026-10-21"]
    # 04:00 UTC on the 22nd is still the 21st in Chicago.
    assert daily_pushes.run(datetime(2026, 10, 22, 4, tzinfo=timezone.utc), send) == {
        "demo": "already_sent"
    }


def test_not_ready_and_failed_sends_stay_retryable(monkeypatch):
    personal_store.set_push_pref("demo", True)
    monkeypatch.setattr(daily_pushes, "PUSHES", {"demo": (7, lambda day: None)})
    assert daily_pushes.run(MORNING, lambda m: True) == {"demo": "not_ready"}
    monkeypatch.setattr(daily_pushes, "PUSHES", {"demo": (7, lambda day: "hi")})
    assert daily_pushes.run(MORNING, lambda m: False) == {"demo": "failed"}
    assert daily_pushes.run(MORNING, lambda m: True) == {"demo": "sent"}


def test_toggle_endpoints_and_auth():
    read, write = {"X-Dashboard-Token": "read"}, {"X-Dashboard-Write-Token": "write"}
    assert _request("GET", "/api/v1/personal/pushes").status_code == 401
    assert _request("GET", "/api/v1/personal/pushes", headers=read).json() == [
        {"kind": "demo", "hour": 7, "enabled": False}
    ]
    def put(kind, headers):
        return _request(
            "PUT", f"/api/v1/personal/pushes/{kind}", json={"enabled": True}, headers=headers
        ).status_code

    assert put("demo", read) == 401
    assert put("nope", write) == 404
    assert put("demo", write) == 204
    assert _request("GET", "/api/v1/personal/pushes", headers=read).json()[0]["enabled"] is True


def test_internal_send_requires_secret_and_reports_status(monkeypatch):
    assert _request("POST", "/internal/daily-pushes/send").status_code == 401
    monkeypatch.setattr(notify, "send_coms_notification", lambda settings, message: True)
    r = _request("POST", "/internal/daily-pushes/send", headers={"X-Internal-Secret": "secret"})
    assert r.status_code == 200 and r.json() == {"demo": "disabled"}
