import asyncio

import httpx
import pytest

from app import main, metrics_store

CLAUDE = {
    "session": {"used_pct": 42.5, "resets_at": "2026-09-30T23:00:00Z"},
    "weekly": {"used_pct": 71.0, "resets_at": "2026-10-03T21:00:00Z"},
}
CODEX = {
    "primary": {"used_pct": 4.0, "resets_at": "2026-10-10T00:00:00Z"},
    "plan_type": "plus",
}
COST = {"period": "2026-09", "total_usd": 12.34, "by_app": {"gym-tracker": 5.0, "vinyl": 7.34}}
NEON = {
    "period": "2026-09",
    "total_compute_hours": 3.5,
    "by_app": {"gym-tracker": 1.25, "vinyl": 2.25},
}


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    metrics_store.configure(str(tmp_path / "metrics.db"))
    monkeypatch.setattr(main.settings, "internal_report_secret", "write")
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def _push(source, body, secret="write"):
    return _request("POST", f"/internal/metrics/{source}", json=body,
                    headers={"X-Internal-Secret": secret})


def _read(token="read"):
    headers = {"X-Dashboard-Token": token} if token is not None else {}
    return _request("GET", "/api/v1/command-center/financials", headers=headers)


def test_push_then_read_round_trip():
    assert _push("claude", CLAUDE).status_code == 204
    assert _push("codex", CODEX).status_code == 204
    assert _push("neon", NEON).status_code == 204
    body = _read().json()
    assert body["claude"]["session"]["used_pct"] == 42.5
    assert body["codex"]["primary"]["used_pct"] == 4.0
    assert body["neon"]["by_app"] == NEON["by_app"]
    assert body["neon"]["total_compute_hours"] == 3.5
    assert body["fly"] is None
    assert "fly" in body["detail"]


def test_second_push_replaces_first():
    _push("fly", COST)
    _push("fly", {**COST, "total_usd": 20.0})
    assert _read().json()["fly"]["total_usd"] == 20.0


def test_read_requires_token():
    assert _read(token="nope").status_code == 401
    assert _read(token=None).status_code == 401


def test_read_token_cannot_write():
    assert _push("claude", CLAUDE, secret="read").status_code == 401


def test_unconfigured_returns_503(monkeypatch):
    monkeypatch.setattr(main.settings, "dashboard_read_token", "")
    assert _read().status_code == 503


def test_unknown_source_and_bad_payload():
    assert _push("stripe", COST).status_code == 404
    assert _push("claude", {"session": {"used_pct": 150, "resets_at": "2026-09-30T23:00:00Z"},
                            "weekly": CLAUDE["weekly"]}).status_code == 422
    assert _push("codex", {"primary": {"used_pct": 4}}).status_code == 422


def test_store_survives_reconfigure(tmp_path):
    path = str(tmp_path / "again.db")
    metrics_store.configure(path)
    metrics_store.save("neon", "{}")
    metrics_store.configure(path)
    assert metrics_store.load("neon") is not None


def test_fly_cost_defaults_to_estimated_and_neon_rejects_dollar_payload():
    _push("fly", COST)
    assert _read().json()["fly"]["estimated"] is True
    assert _push("neon", COST).status_code == 422


def test_push_attempts_are_logged_and_readable_with_token():
    _push("claude", {"session": {"used_pct": 150}})
    _push("claude", CLAUDE)
    _push("claude", CLAUDE, secret="nope")  # rejected before the handler: not logged
    url = "/api/v1/automations/claude-usage/runs"
    assert _request("GET", url).status_code == 401
    runs = _request("GET", url, headers={"X-Dashboard-Token": "read"}).json()
    assert [(r["ok"], r["detail"]) for r in runs] == [(True, ""), (False, "invalid_payload")]
    assert _request(
        "GET", "/api/v1/automations/nope/runs", headers={"X-Dashboard-Token": "read"}
    ).status_code == 404
