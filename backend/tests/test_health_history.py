import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from app import health_history, main
from app.monitoring import Monitor
from app.schemas import AppDefinition, CheckResult

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def _result(app_id: str, state: str, minutes_ago: float, ms: float | None = 100.0) -> CheckResult:
    return CheckResult(
        app_id=app_id,
        name=app_id,
        category="Test",
        description="",
        state=state,
        checked_at=NOW - timedelta(minutes=minutes_ago),
        response_ms=ms,
    )


def test_summary_uptime_latency_and_unavailable_excluded(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"))
    health_history.record(
        [
            _result("a", "up", 50, 100),
            _result("a", "slow", 40, 300),
            _result("a", "down", 30, None),
            _result("a", "degraded", 20, 200),
            _result("a", "unavailable", 10, None),
            _result("b", "down", 10),
        ]
    )

    out = health_history.history("a", "24h", now=NOW)

    assert out["summary"]["checks"] == 5
    # 4 counted (unavailable excluded), 2 failing (down, degraded) -> 50%
    assert out["summary"]["uptime_pct"] == 50.0
    assert out["summary"]["avg_response_ms"] == 200.0
    assert out["summary"]["last_state"] == "unavailable"


def test_window_excludes_old_rows_and_empty_is_none(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"))
    health_history.record([_result("a", "up", 60 * 25)])  # 25h ago

    out = health_history.history("a", "24h", now=NOW)

    assert out["points"] == []
    assert out["summary"]["uptime_pct"] is None
    assert health_history.history("a", "7d", now=NOW)["summary"]["checks"] == 1


def test_buckets_use_worst_state_and_average_latency(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"))
    # 24h buckets are 5 minutes; these three land in one bucket (11:50:00-11:54:59).
    base = NOW - timedelta(minutes=10)
    for seconds, state, ms in [(0, "up", 100), (60, "down", 300), (120, "slow", 200)]:
        at = base + timedelta(seconds=seconds)
        r = _result("a", state, 0, ms).model_copy(update={"checked_at": at})
        health_history.record([r])

    points = health_history.history("a", "24h", now=NOW)["points"]

    assert len(points) == 1
    assert points[0]["state"] == "down"
    assert points[0]["response_ms"] == 200.0


def test_prune_removes_rows_past_retention(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"), retention_days=1)
    health_history.record([_result("a", "up", 60 * 24 * 3)])  # 3 days old; prune runs after insert

    assert health_history.history("a", "30d", now=NOW)["summary"]["checks"] == 0


def test_monitor_records_fresh_checks_but_not_cached(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"))
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="",
        product_url="https://example.com",
        health_url="https://health.example.com",
    )
    monitor = Monitor(cache_ttl_seconds=60)

    async def run() -> None:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "ok"}))
        original = httpx.AsyncClient
        httpx.AsyncClient = lambda **kw: original(transport=transport, **kw)  # type: ignore[assignment]
        try:
            await monitor.dashboard((app,))
            await monitor.dashboard((app,))  # served from cache
        finally:
            httpx.AsyncClient = original  # type: ignore[assignment]

    asyncio.run(run())

    assert health_history.history("fixture", "24h")["summary"]["checks"] == 1


def test_endpoint_unknown_app_404_and_known_app_ok(tmp_path) -> None:
    health_history.configure(str(tmp_path / "h.db"))
    app_id = main.get_registry(main.settings.profile)[0].id

    async def get(path: str) -> httpx.Response:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    assert asyncio.run(get("/api/v1/apps/nope/health-history")).status_code == 404
    ok = asyncio.run(get(f"/api/v1/apps/{app_id}/health-history?range=7d"))
    assert ok.status_code == 200 and ok.json()["range"] == "7d"
    assert asyncio.run(get(f"/api/v1/apps/{app_id}/health-history?range=1y")).status_code == 422
