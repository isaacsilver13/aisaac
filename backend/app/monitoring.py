from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from . import alerts, health_history, incidents, reports
from .config import Settings
from .schemas import AppDefinition, CheckResult, HealthState

# Fly's proxy answers these while a stopped machine is still starting.
RETRYABLE_STATUSES = frozenset({502, 503, 504})


logger = logging.getLogger("aisaac.monitoring")


class Monitor:
    def __init__(
        self,
        cache_ttl_seconds: float = 20.0,
        settings: Settings | None = None,
        retry_delay_seconds: float = 2.0,
        slow_after_ms: float = 8000.0,
    ) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        self.settings = settings
        self.retry_delay_seconds = retry_delay_seconds
        self.slow_after_ms = slow_after_ms
        self._cache: tuple[float, list[CheckResult]] | None = None
        self._last_state: dict[str, HealthState] = {}

    async def dashboard(
        self, apps: tuple[AppDefinition, ...], force_refresh: bool = False
    ) -> list[CheckResult]:
        now = time.monotonic()
        if not force_refresh and self._cache and now - self._cache[0] < self.cache_ttl_seconds:
            return [result.model_copy(update={"cached": True}) for result in self._cache[1]]

        async with httpx.AsyncClient(follow_redirects=True) as client:
            results = list(await asyncio.gather(*(self.check_app(client, app) for app in apps)))
        self._cache = (time.monotonic(), results)
        try:
            health_history.record(results)
        except Exception:  # history must never break the live dashboard
            logger.exception("Could not record health history")
        for result in results:
            self._handle_transition(result)
        return results

    def _handle_transition(self, result: CheckResult) -> None:
        previous = self._last_state.get(result.app_id)
        current = result.state
        self._last_state[result.app_id] = current
        if previous is None or previous == current:
            return

        was_failing = previous in ("down", "degraded")
        is_failing = current in ("down", "degraded")
        if is_failing and not was_failing:
            if incidents.get_open_incident(result.app_id) is None:
                incidents.open_incident(result.app_id, failure_type=current)
        elif was_failing and not is_failing:
            open_incident = incidents.get_open_incident(result.app_id)
            if open_incident is not None:
                incidents.resolve_incident(
                    open_incident["id"], notes="Auto-resolved: check recovered."
                )

        if self.settings is not None:
            alerts.send_transition_alert(self.settings, result.name, previous, current)

    async def check_app(self, client: httpx.AsyncClient, app: AppDefinition) -> CheckResult:
        checked_at = datetime.now(timezone.utc)
        if not app.enabled:
            return self._unavailable(app, checked_at, "Not configured for this environment.")
        if app.monitor_target == "push":
            return self._check_pushed_report(app, checked_at)
        if app.monitor_target == "page":
            return await self._check_page(client, app, checked_at)
        if app.health_url is None:
            return self._unavailable(app, checked_at, "No health endpoint is configured.")

        started = time.perf_counter()
        response, error, retried = await self._get_with_retry(client, app)
        if response is None:
            return self._failure(app, checked_at, started, error or "Health check failed.")

        response_ms = round((time.perf_counter() - started) * 1000, 1)
        if response.status_code < 200 or response.status_code >= 300:
            return self._failure(
                app,
                checked_at,
                started,
                f"Endpoint returned HTTP {response.status_code}.",
                response.status_code,
            )

        payload: dict[str, Any] = {}
        if app.check_kind == "json":
            try:
                parsed = response.json()
            except ValueError:
                return self._failure(
                    app,
                    checked_at,
                    started,
                    "Endpoint returned invalid JSON.",
                    response.status_code,
                )
            if isinstance(parsed, dict):
                payload = parsed

        normalized_payload = self._unwrap_payload(payload)
        state = self._state_from_payload(normalized_payload)
        detail = self._detail_from_payload(normalized_payload)
        readiness = await self._check_readiness(client, app)
        if state == "up" and readiness == "down":
            state = "degraded"
        provider_state = self._string_value(
            normalized_payload.get("provider_status") or normalized_payload.get("provider_state")
        )
        metrics = self._metrics_from_payload(normalized_payload, app.metric_allowlist)
        metrics_state, metrics, metrics_provider_state = await self._check_metrics(
            client, app, metrics
        )
        if provider_state is None:
            provider_state = metrics_provider_state
        if state == "up" and metrics_state == "down":
            state = "degraded"
        page_state = await self._check_page_state(client, app)
        if state == "up" and page_state == "down":
            state = "degraded"
        if state == "up" and (retried or response_ms >= self.slow_after_ms):
            state = "slow"
            detail = detail or (
                "Waking up: first attempt failed, recovered on retry."
                if retried
                else f"Slow response ({response_ms:.0f} ms)."
            )
        return CheckResult(
            app_id=app.id,
            name=app.name,
            category=app.category,
            description=app.description,
            product_url=app.product_url,
            state=state,
            checked_at=checked_at,
            response_ms=response_ms,
            http_status=response.status_code,
            readiness=readiness,
            provider_state=provider_state,
            freshness=self._freshness(metrics),
            page_state=page_state,
            metrics_state=metrics_state,
            metrics=metrics,
            detail=detail,
        )

    async def _get_with_retry(
        self, client: httpx.AsyncClient, app: AppDefinition
    ) -> tuple[httpx.Response | None, str | None, bool]:
        """GET the health URL, retrying once so a Fly cold start is not reported as down."""
        error: str | None = None
        for attempt in range(2):
            if attempt:
                await asyncio.sleep(self.retry_delay_seconds)
            try:
                response = await client.get(str(app.health_url), timeout=app.timeout_seconds)
            except httpx.TimeoutException:
                error = "Health check timed out."
                continue
            except httpx.HTTPError:
                error = "Health check could not connect."
                continue
            if attempt == 0 and response.status_code in RETRYABLE_STATUSES:
                error = f"Endpoint returned HTTP {response.status_code}."
                continue
            return response, None, attempt > 0
        return None, error, True

    def _check_pushed_report(self, app: AppDefinition, checked_at: datetime) -> CheckResult:
        stale_after = self.settings.stale_report_after_hours if self.settings else 26.0
        report = reports.get_report(app.id, stale_after_hours=stale_after)
        if report is None:
            return CheckResult(
                app_id=app.id,
                name=app.name,
                category=app.category,
                description=app.description,
                product_url=app.product_url,
                state="stale",
                checked_at=checked_at,
                detail="No recent heartbeat received.",
            )
        state = self._state_from_payload({"status": report.status})
        return CheckResult(
            app_id=app.id,
            name=app.name,
            category=app.category,
            description=app.description,
            product_url=app.product_url,
            state=state,
            checked_at=report.received_at,
            metrics=self._metrics_from_payload(report.metrics, app.metric_allowlist),
        )

    async def _check_page(
        self, client: httpx.AsyncClient, app: AppDefinition, checked_at: datetime
    ) -> CheckResult:
        if app.product_url is None:
            return self._unavailable(app, checked_at, "No page endpoint is configured.")
        started = time.perf_counter()
        try:
            response = await client.get(str(app.product_url), timeout=app.timeout_seconds)
        except httpx.TimeoutException:
            return self._failure(app, checked_at, started, "Page check timed out.")
        except httpx.HTTPError:
            return self._failure(app, checked_at, started, "Page check could not connect.")
        if response.status_code < 200 or response.status_code >= 300:
            return self._failure(
                app,
                checked_at,
                started,
                f"Page returned HTTP {response.status_code}.",
                response.status_code,
            )
        return CheckResult(
            app_id=app.id,
            name=app.name,
            category=app.category,
            description=app.description,
            product_url=app.product_url,
            state="up",
            page_state="up",
            checked_at=checked_at,
            response_ms=round((time.perf_counter() - started) * 1000, 1),
            http_status=response.status_code,
        )

    async def _check_page_state(
        self, client: httpx.AsyncClient, app: AppDefinition
    ) -> HealthState | None:
        if app.product_url is None:
            return None
        try:
            response = await client.get(str(app.product_url), timeout=app.timeout_seconds)
        except httpx.HTTPError:
            return "down"
        return "up" if 200 <= response.status_code < 300 else "down"

    @staticmethod
    def _state_from_payload(payload: dict[str, Any]) -> HealthState:
        status = str(payload.get("status", "ok")).lower()
        if status in {"ok", "healthy", "up", "ready"}:
            return "up"
        if status in {"degraded", "warning", "unconfigured"}:
            return "degraded"
        return "down"

    @staticmethod
    def _unwrap_payload(payload: dict[str, Any]) -> dict[str, Any]:
        nested = payload.get("data")
        return nested if isinstance(nested, dict) else payload

    @staticmethod
    def _detail_from_payload(payload: dict[str, Any]) -> str | None:
        for key in ("message", "detail", "error"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value[:240]
        return None

    @staticmethod
    def _metrics_from_payload(
        payload: dict[str, Any], allowlist: tuple[str, ...]
    ) -> dict[str, Any]:
        reserved = {"status", "message", "detail", "error", "provider_status", "provider_state"}
        return {
            key: value
            for key, value in payload.items()
            if key not in reserved
            and key in allowlist  # empty allowlist = expose nothing
            and isinstance(value, (str, int, float, bool))
        }

    @staticmethod
    def _freshness(metrics: dict[str, Any]) -> datetime | None:
        value = metrics.get("data_freshness_at")
        try:
            return datetime.fromisoformat(value) if isinstance(value, str) else None
        except ValueError:
            return None

    async def _check_metrics(
        self,
        client: httpx.AsyncClient,
        app: AppDefinition,
        metrics: dict[str, Any],
    ) -> tuple[HealthState | None, dict[str, Any], str | None]:
        if app.metrics_url is None:
            return None, metrics, None
        headers: dict[str, str] = {}
        if app.metrics_token_setting:
            token = str(getattr(self.settings, app.metrics_token_setting, "") or "")
            if not token:
                return None, metrics, None
            headers["X-Metrics-Token"] = token
        try:
            response = await client.get(
                str(app.metrics_url),
                headers=headers,
                timeout=app.timeout_seconds,
                # httpx strips only Authorization on cross-origin redirects, so a custom
                # token header must never be sent through one.
                follow_redirects=not headers,
            )
            if response.status_code < 200 or response.status_code >= 300:
                return "down", metrics, None
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return "down", metrics, None
        if not isinstance(payload, dict):
            return "down", metrics, None
        normalized = self._unwrap_payload(payload)
        provider_state = self._string_value(
            normalized.get("provider_status") or normalized.get("provider_state")
        )
        return (
            "up",
            {**metrics, **self._metrics_from_payload(normalized, app.metric_allowlist)},
            provider_state,
        )

    async def _check_readiness(
        self, client: httpx.AsyncClient, app: AppDefinition
    ) -> HealthState | None:
        if app.readiness_url is None:
            return None
        try:
            response = await client.get(str(app.readiness_url), timeout=app.timeout_seconds)
        except httpx.HTTPError:
            return "down"
        if response.status_code < 200 or response.status_code >= 300:
            return "down"
        try:
            payload = response.json()
        except ValueError:
            return "down"
        return self._state_from_payload(payload if isinstance(payload, dict) else {})

    @staticmethod
    def _string_value(value: Any) -> str | None:
        return value if isinstance(value, str) else None

    @staticmethod
    def _unavailable(app: AppDefinition, checked_at: datetime, detail: str) -> CheckResult:
        return CheckResult(
            app_id=app.id,
            name=app.name,
            category=app.category,
            description=app.description,
            product_url=app.product_url,
            state="unavailable",
            checked_at=checked_at,
            detail=detail,
        )

    @staticmethod
    def _failure(
        app: AppDefinition,
        checked_at: datetime,
        started: float,
        detail: str,
        http_status: int | None = None,
    ) -> CheckResult:
        return CheckResult(
            app_id=app.id,
            name=app.name,
            category=app.category,
            description=app.description,
            product_url=app.product_url,
            state="down",
            checked_at=checked_at,
            response_ms=round((time.perf_counter() - started) * 1000, 1),
            http_status=http_status,
            detail=detail,
        )
