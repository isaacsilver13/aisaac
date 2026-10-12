import asyncio

import httpx

from app import incidents, reports
from app.config import Settings
from app.monitoring import Monitor
from app.schemas import AppDefinition


def test_check_app_normalizes_healthy_json() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        product_url="https://example.com",
        health_url="https://health.example.com",
        metric_allowlist=("version", "records"),
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok", "version": "1.2.3", "records": 7})

    transport = httpx.MockTransport(handler)
    async def run_check() -> object:
        async with httpx.AsyncClient(transport=transport) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "up"
    assert result.metrics == {"version": "1.2.3", "records": 7}
    assert result.http_status == 200
    assert result.response_ms is not None


def test_check_app_classifies_provider_warning_as_degraded() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "unconfigured", "provider_status": "missing"})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "degraded"
    assert result.provider_state == "missing"


def test_check_app_unwraps_nested_health_payload() -> None:
    app = AppDefinition(
        id="nfl",
        name="NFL",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com/health",
        metric_allowlist=("scheduler",),
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"status": "healthy", "scheduler": "running"}})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "up"
    assert result.metrics == {"scheduler": "running"}


def test_check_app_reports_page_failure_as_degraded() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        product_url="https://app.example.com",
        health_url="https://health.example.com",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "app.example.com":
            return httpx.Response(503)
        return httpx.Response(200, json={"status": "ok"})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "degraded"
    assert result.page_state == "down"


def test_check_app_allowlists_metrics_from_secondary_status_url() -> None:
    app = AppDefinition(
        id="betting",
        name="Betting",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
        metrics_url="https://status.example.com",
        metric_allowlist=("provider_status", "event_count"),
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "status.example.com":
            return httpx.Response(
                200,
                json={"provider_status": "fixture", "event_count": 4, "secret": "omit"},
            )
        return httpx.Response(200, json={"status": "ok"})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "up"
    assert result.metrics == {"event_count": 4}
    assert result.provider_state == "fixture"
    assert result.metrics_state == "up"


def _check(app: AppDefinition, health: dict, metrics: dict | None = None) -> object:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=metrics if request.url.host == "m.example.com" else health)

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    return asyncio.run(run_check())


def test_no_allowlist_means_no_metrics() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
        metrics_url="https://m.example.com",
    )

    result = _check(app, {"status": "ok", "balance": 5}, {"total": 9})

    assert result.metrics == {}
    assert result.metrics_state == "up"


def _token_app() -> AppDefinition:
    return AppDefinition(
        id="portfolio",
        name="Portfolio",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
        metrics_url="https://m.example.com",
        metric_allowlist=("positions_count",),
        metrics_token_setting="portfolio_metrics_token",
    )


def test_metrics_token_is_sent_only_to_the_metrics_url() -> None:
    seen: dict[str, str | None] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen[request.url.host] = request.headers.get("x-metrics-token")
        return httpx.Response(200, json={"status": "ok", "positions_count": 4})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            monitor = Monitor(settings=Settings(portfolio_metrics_token="tok"))
            return await monitor.check_app(client, _token_app())

    result = asyncio.run(run_check())

    assert seen == {"health.example.com": None, "m.example.com": "tok"}
    assert result.metrics == {"positions_count": 4}
    assert result.metrics_state == "up"


def test_metrics_token_is_never_forwarded_on_a_redirect() -> None:
    tokens_seen: dict[str, str | None] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        tokens_seen[request.url.host] = request.headers.get("x-metrics-token")
        if request.url.host == "m.example.com":
            return httpx.Response(302, headers={"location": "https://evil.example.net/steal"})
        return httpx.Response(200, json={"status": "ok"})

    async def run_check() -> object:
        # Same client config the dashboard uses: redirects are followed by default.
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=True
        ) as client:
            monitor = Monitor(settings=Settings(portfolio_metrics_token="tok"))
            return await monitor.check_app(client, _token_app())

    result = asyncio.run(run_check())

    assert "evil.example.net" not in tokens_seen
    assert result.metrics == {} and result.metrics_state == "down"


def test_unset_metrics_token_skips_the_request_without_degrading() -> None:
    hosts: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return httpx.Response(200, json={"status": "ok"})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            monitor = Monitor(settings=Settings(portfolio_metrics_token=""))
            return await monitor.check_app(client, _token_app())

    result = asyncio.run(run_check())

    assert "m.example.com" not in hosts
    assert result.state == "up" and result.metrics_state is None and result.metrics == {}


def test_freshness_comes_from_allowlisted_data_freshness_at() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
        metrics_url="https://m.example.com",
        metric_allowlist=("data_freshness_at",),
    )

    good = _check(app, {"status": "ok"}, {"data_freshness_at": "2026-10-05T12:00:00+00:00"})
    assert good.freshness is not None and good.freshness.year == 2026
    assert _check(app, {"status": "ok"}, {"data_freshness_at": "not a date"}).freshness is None
    assert _check(app, {"status": "ok"}, {"data_freshness_at": None}).freshness is None


def test_check_app_separates_readiness_from_liveness() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com/health",
        readiness_url="https://health.example.com/ready",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ready":
            return httpx.Response(503, json={"status": "down"})
        return httpx.Response(200, json={"status": "ok"})

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "degraded"
    assert result.readiness == "down"


def test_check_app_classifies_timeout_without_leaking_exception() -> None:
    app = AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("secret target details")

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await Monitor().check_app(client, app)

    import asyncio

    result = asyncio.run(run_check())

    assert result.state == "down"
    assert result.detail == "Health check timed out."


def test_dashboard_uses_ttl_cache() -> None:
    app = AppDefinition(
        id="disabled",
        name="Disabled",
        category="Test",
        description="Disabled service",
        enabled=False,
    )
    monitor = Monitor(cache_ttl_seconds=30)

    import asyncio

    async def run_dashboard() -> tuple[list[object], list[object]]:
        first = await monitor.dashboard((app,))
        second = await monitor.dashboard((app,))
        return first, second

    first, second = asyncio.run(run_dashboard())

    assert first[0].cached is False
    assert second[0].cached is True
    assert second[0].state == "unavailable"


def test_push_target_reports_stale_without_a_heartbeat() -> None:
    app = AppDefinition(
        id="never-reported",
        name="Never Reported",
        category="Test",
        description="Fixture service",
        monitor_target="push",
    )

    transport = httpx.MockTransport(lambda r: httpx.Response(200))

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=transport) as client:
            return await Monitor().check_app(client, app)

    result = asyncio.run(run_check())

    assert result.state == "stale"


def test_push_target_reflects_recent_heartbeat() -> None:
    reports.record_report("pushed-app", "ok", {"last_run_score": 1.0})
    app = AppDefinition(
        id="pushed-app",
        name="Pushed App",
        category="Test",
        description="Fixture service",
        monitor_target="push",
        metric_allowlist=("last_run_score",),
    )

    transport = httpx.MockTransport(lambda r: httpx.Response(200))

    async def run_check() -> object:
        async with httpx.AsyncClient(transport=transport) as client:
            return await Monitor().check_app(client, app)

    result = asyncio.run(run_check())

    assert result.state == "up"
    assert result.metrics == {"last_run_score": 1.0}


def test_dashboard_opens_incident_on_transition_to_down(tmp_path) -> None:
    incidents.configure(str(tmp_path / "incidents.db"))
    app = AppDefinition(
        id="flaky",
        name="Flaky",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com",
    )
    # A 503 is retried once, so "down" needs it to persist across both attempts.
    responses = iter(
        [httpx.Response(200, json={"status": "ok"}), httpx.Response(503), httpx.Response(503)]
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        return next(responses)

    monitor = Monitor(cache_ttl_seconds=0, retry_delay_seconds=0)

    async def run_dashboard() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            monitor._handle_transition(await monitor.check_app(client, app))
            monitor._handle_transition(await monitor.check_app(client, app))

    asyncio.run(run_dashboard())

    assert incidents.get_open_incident("flaky") is not None


def test_dashboard_resolves_incident_on_recovery(tmp_path) -> None:
    incidents.configure(str(tmp_path / "incidents.db"))
    incidents.open_incident("recovering", failure_type="down")
    monitor = Monitor()
    monitor._last_state["recovering"] = "down"

    from datetime import datetime, timezone

    from app.schemas import CheckResult

    result = CheckResult(
        app_id="recovering",
        name="Recovering",
        category="Test",
        description="Fixture",
        state="up",
        checked_at=datetime.now(timezone.utc),
    )

    monitor._handle_transition(result)

    assert incidents.get_open_incident("recovering") is None


def test_check_app_default_timeout_and_slow_threshold_are_sane() -> None:
    monitor = Monitor()
    assert monitor.slow_after_ms == 8000.0
    assert monitor.retry_delay_seconds == 2.0


def test_slow_state_does_not_open_an_incident(tmp_path) -> None:
    from datetime import datetime, timezone

    from app.schemas import CheckResult

    incidents.configure(str(tmp_path / "incidents.db"))
    monitor = Monitor()

    def result(state: str) -> CheckResult:
        return CheckResult(
            app_id="fixture",
            name="Fixture",
            category="Test",
            description="Fixture service",
            state=state,
            checked_at=datetime.now(timezone.utc),
        )

    monitor._handle_transition(result("up"))
    monitor._handle_transition(result("slow"))

    assert incidents.get_open_incident("fixture") is None


def _cold_start_app() -> AppDefinition:
    return AppDefinition(
        id="fixture",
        name="Fixture",
        category="Test",
        description="Fixture service",
        health_url="https://health.example.com/health",
    )


def _run_check(handler, monitor: Monitor):
    async def run() -> object:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor.check_app(client, _cold_start_app())

    return asyncio.run(run())


def test_default_health_timeout_is_ten_seconds() -> None:
    assert _cold_start_app().timeout_seconds == 10.0


def test_check_app_retries_once_and_reports_slow_when_first_attempt_fails() -> None:
    for first_failure in ("connect_error", "http_503"):
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                if first_failure == "connect_error":
                    raise httpx.ConnectError("machine is waking up")
                return httpx.Response(503)
            return httpx.Response(200, json={"status": "ok"})

        result = _run_check(handler, Monitor(retry_delay_seconds=0))

        assert calls == 2, first_failure
        assert result.state == "slow", first_failure
        assert result.http_status == 200
        assert "waking up" in (result.detail or "").lower()


def test_check_app_reports_down_with_error_after_two_failed_attempts() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("boom")

    result = _run_check(handler, Monitor(retry_delay_seconds=0))

    assert calls == 2
    assert result.state == "down"
    assert result.detail == "Health check could not connect."


def test_check_app_does_not_retry_client_errors() -> None:
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404)

    result = _run_check(handler, Monitor(retry_delay_seconds=0))

    assert calls == 1
    assert result.state == "down"
    assert result.http_status == 404


def test_check_app_reports_slow_when_response_is_late() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"status": "ok"})

    result = _run_check(handler, Monitor(slow_after_ms=20))

    assert result.state == "slow"
    assert result.http_status == 200
