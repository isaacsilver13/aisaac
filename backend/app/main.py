import asyncio
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, model_validator

from . import (
    automations,
    ci_events,
    fly_client,
    health_history,
    incidents,
    learning,
    metrics_store,
    notify,
    personal_connect,
    personal_digest,
    personal_ebay,
    personal_news,
    personal_own,
    personal_shoes,
    personal_sports,
    personal_stockx,
    personal_store,
    personal_vault,
    reports,
    second_brain_store,
)
from .agents_registry import get_agents
from .alerts import send_email
from .config import get_settings
from .github_monitor import GitHubMonitor
from .github_registry import get_repos
from .monitoring import Monitor
from .registry import STACKS, get_registry
from .schemas import (
    AgentSummary,
    AppDefinition,
    AppInfo,
    CIEventOut,
    CIReportIn,
    ClaudeUsageIn,
    ClaudeUsageOut,
    CodexUsageIn,
    CodexUsageOut,
    DashboardResponse,
    FinancialSnapshot,
    HostingCostRow,
    IncidentOut,
    LearningProgressIn,
    NeonUsageIn,
    NeonUsageOut,
    ProviderCostIn,
    ProviderCostOut,
    PushReportIn,
    RepoActivity,
    ResolveIncidentIn,
    SecondBrainSyncIn,
)

settings = get_settings()
incidents.configure(settings.incidents_db_path)
ci_events.configure(settings.ci_events_db_path)
metrics_store.configure(settings.metrics_db_path)
second_brain_store.configure(settings.second_brain_db_path)
personal_store.configure(settings.personal_db_path)
personal_shoes.PROVIDER = personal_ebay.make_provider(
    settings.ebay_client_id, settings.ebay_client_secret
)
personal_connect.SPECS.update(personal_connect.make_specs(
    settings.ebay_client_id, settings.ebay_client_secret, settings.ebay_runame,
    settings.ebay_user_scopes, settings.stockx_client_id, settings.stockx_client_secret,
))
_stockx_fetch = personal_stockx.make_fetcher(
    settings.stockx_client_id, settings.stockx_client_secret, settings.stockx_api_key
)
if _stockx_fetch:
    personal_own.FETCHERS["stockx"] = _stockx_fetch
personal_shoes.STOCKX_PROVIDER = personal_stockx.make_market_provider(
    settings.stockx_client_id, settings.stockx_client_secret, settings.stockx_api_key,
    lambda: personal_vault.load_token("stockx", settings.token_encryption_key),
)
health_history.configure(settings.health_db_path, settings.health_retention_days)
_last_notified_at: dict[str, float] = {}
monitor = Monitor(cache_ttl_seconds=settings.cache_ttl_seconds, settings=settings)
github_monitor = GitHubMonitor(
    token=settings.github_token, cache_ttl_seconds=settings.github_cache_ttl_seconds
)
async def _poll_health(interval: float) -> None:
    while True:
        try:
            await monitor.dashboard(get_registry(settings.profile), force_refresh=True)
        except Exception:
            logging.getLogger("aisaac.monitoring").exception("Health poll failed")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    poller = None
    if settings.health_poll_interval_seconds > 0:
        poller = asyncio.create_task(_poll_health(settings.health_poll_interval_seconds))
    yield
    if poller:
        poller.cancel()


app = FastAPI(title="AIsaac Dashboard", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "aisaac-dashboard"}


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
async def dashboard(
    force_refresh: bool = Query(default=False),
    x_dashboard_token: Optional[str] = Header(default=None),
) -> DashboardResponse:
    if force_refresh:
        _require_read_token(x_dashboard_token)
    apps = get_registry(settings.profile)
    results = await monitor.dashboard(apps, force_refresh=force_refresh)
    return DashboardResponse(
        profile=settings.profile,
        refreshed_at=datetime.now(timezone.utc),
        results=results,
    )


@app.get("/api/v1/apps/{app_id}/health-history")
def app_health_history(
    app_id: str, range: health_history.Range = Query(default="24h")
) -> dict:
    if app_id not in {a.id for a in get_registry(settings.profile)}:
        raise HTTPException(404, "Unknown application.")
    return health_history.history(app_id, range)


@app.get("/api/v1/apps", response_model=list[AppInfo])
def list_apps(x_dashboard_token: Optional[str] = Header(default=None)) -> list[AppInfo]:
    """Registry entries (public URLs only, like /dashboard). The stack map names versions,
    hosts and databases, so it is only included for holders of the read token."""
    show_stack = bool(settings.dashboard_read_token) and _secrets_match(
        x_dashboard_token, settings.dashboard_read_token
    )
    return [
        AppInfo(
            **a.model_dump(include=set(AppInfo.model_fields) - {"stack"}),
            stack=STACKS.get(a.id) if show_stack else None,
        )
        for a in get_registry(settings.profile)
    ]


def _secrets_match(supplied: Optional[str], expected: str) -> bool:
    # Constant-time; compare bytes so a non-ASCII header can't raise TypeError (a 500).
    return hmac.compare_digest((supplied or "").encode(), expected.encode())


def _require_internal_secret(x_internal_secret: Optional[str] = Header(default=None)) -> None:
    if not settings.internal_report_secret:
        raise HTTPException(503, "Push reporting is not configured on this deployment.")
    if not _secrets_match(x_internal_secret, settings.internal_report_secret):
        raise HTTPException(401, "Invalid or missing internal report secret.")


@app.post("/internal/report", status_code=204, dependencies=[Depends(_require_internal_secret)])
def internal_report(payload: PushReportIn) -> None:
    reports.record_report(payload.app_id, payload.status, payload.metrics)


def _require_read_token(x_dashboard_token: Optional[str] = Header(default=None)) -> None:
    if not settings.dashboard_read_token:
        raise HTTPException(503, "Financial figures are not configured on this deployment.")
    if not _secrets_match(x_dashboard_token, settings.dashboard_read_token):
        raise HTTPException(401, "Invalid or missing dashboard token.")


def _require_write_token(x_dashboard_write_token: Optional[str] = Header(default=None)) -> None:
    if not settings.dashboard_write_token:
        raise HTTPException(503, "Dashboard write actions are not configured on this deployment.")
    if not _secrets_match(x_dashboard_write_token, settings.dashboard_write_token):
        raise HTTPException(401, "Invalid or missing dashboard write token.")


async def _fly_lookup(app_id: str, call) -> dict:
    """Shared by the Fly-backed tabs: resolve the app, then run `call(client, token, fly_app)`."""
    definition = next((a for a in get_registry(settings.profile) if a.id == app_id), None)
    if definition is None:
        raise HTTPException(404, "Unknown application.")
    if not definition.fly_app:
        return {"app_id": app_id, "fly_app": None, "items": []}
    if not settings.fly_api_token:
        raise HTTPException(503, "Fly access is not configured on this deployment.")
    try:
        async with httpx.AsyncClient() as client:
            items = await call(client, settings.fly_api_token, definition.fly_app)
    except (httpx.HTTPError, ValueError):
        logging.getLogger("aisaac.fly").exception("Fly lookup failed for %s", app_id)
        raise HTTPException(502, "Could not read from Fly.")
    return {"app_id": app_id, "fly_app": definition.fly_app, "items": items}


@app.get("/api/v1/apps/{app_id}/deployments", dependencies=[Depends(_require_read_token)])
async def app_deployments(app_id: str) -> dict:
    out = await _fly_lookup(app_id, fly_client.releases)
    return {"app_id": out["app_id"], "fly_app": out["fly_app"], "releases": out["items"]}


@app.get("/api/v1/apps/{app_id}/logs", dependencies=[Depends(_require_read_token)])
async def app_logs(app_id: str) -> dict:
    out = await _fly_lookup(app_id, fly_client.logs)
    return {"app_id": out["app_id"], "fly_app": out["fly_app"], "lines": out["items"]}


_METRIC_MODELS = {
    "claude": ClaudeUsageIn,
    "codex": CodexUsageIn,
    "neon": NeonUsageIn,
    "fly": ProviderCostIn,
}


@app.post(
    "/internal/metrics/{source}",
    status_code=204,
    dependencies=[Depends(_require_internal_secret)],
)
def internal_metrics(source: str, payload: dict) -> None:
    model = _METRIC_MODELS.get(source)
    if model is None:
        raise HTTPException(404, f"Unknown metrics source '{source}'.")
    try:
        parsed = model.model_validate(payload)
    except ValidationError as exc:
        metrics_store.record_run(source, ok=False, error="invalid_payload")
        raise HTTPException(422, exc.errors(include_url=False, include_context=False)) from exc
    metrics_store.save(source, parsed.model_dump_json())


def hosting_breakdown(
    apps: tuple[AppDefinition, ...],
    fly: Optional[ProviderCostOut],
    neon: Optional[NeonUsageOut],
) -> tuple[list[HostingCostRow], Optional[float]]:
    """Fold pushed Fly apps and Neon projects into one row per registry app.

    A source belongs to an app when its name is the app's id, fly_app or a cost alias;
    anything else keeps its own row so no cost is hidden.
    """
    owner = {name: a for a in apps for name in (a.id, a.fly_app, *a.cost_aliases) if name}
    rows: dict[str, HostingCostRow] = {}

    def row(source: str) -> HostingCostRow:
        a = owner.get(source)
        key, name = (a.id, a.name) if a else (source, source)
        return rows.setdefault(key, HostingCostRow(key=key, name=name))

    if fly:
        for source, usd in fly.by_app.items():
            r = row(source)
            r.fly_usd = (r.fly_usd or 0.0) + usd
            if source in fly.machine_hours:
                r.fly_hours = (r.fly_hours or 0.0) + fly.machine_hours[source]
    allowance = neon.free_hours_per_project if neon else None
    if neon:
        for source, hours in neon.by_app.items():
            r = row(source)
            r.neon_hours = (r.neon_hours or 0.0) + hours
            if allowance:
                # Free plan: exactly $0; the allowance is per project, so show the fullest one.
                r.neon_usd = 0.0
                pct = 100 * hours / allowance
                r.neon_allowance_pct = max(r.neon_allowance_pct or 0.0, pct)
    for r in rows.values():
        if r.fly_usd is not None:
            r.fly_usd = round(r.fly_usd, 2)
        if r.fly_hours is not None:
            r.fly_hours = round(r.fly_hours, 2)
        if r.neon_hours is not None:
            r.neon_hours = round(r.neon_hours, 3)
        r.total_usd = round((r.fly_usd or 0.0) + (r.neon_usd or 0.0), 2)
    ordered = sorted(rows.values(), key=lambda r: (-r.total_usd, r.name.lower()))
    total = round(sum(r.total_usd for r in ordered), 2) if (fly or allowance) else None
    return ordered, total


@app.get(
    "/api/v1/command-center/financials",
    response_model=FinancialSnapshot,
    dependencies=[Depends(_require_read_token)],
)
def financials() -> FinancialSnapshot:
    def _load(source: str, out_model):
        row = metrics_store.load(source)
        if row is None:
            return None
        return out_model.model_validate(
            {**json.loads(row["payload"]), "reported_at": row["reported_at"]}
        )

    claude = _load("claude", ClaudeUsageOut)
    codex = _load("codex", CodexUsageOut)
    neon = _load("neon", NeonUsageOut)
    fly = _load("fly", ProviderCostOut)
    missing = [
        name
        for name, value in (("claude", claude), ("codex", codex), ("neon", neon), ("fly", fly))
        if value is None
    ]
    # Costs map onto production apps whatever profile this deployment checks.
    hosting, hosting_total = hosting_breakdown(get_registry("production"), fly, neon)
    return FinancialSnapshot(
        claude=claude,
        codex=codex,
        neon=neon,
        fly=fly,
        hosting=hosting,
        hosting_total_usd=hosting_total,
        detail=f"No data reported yet for: {', '.join(missing)}." if missing else None,
    )


@app.get(
    "/api/v1/incidents",
    response_model=list[IncidentOut],
    dependencies=[Depends(_require_read_token)],
)
def list_incidents(app_id: Optional[str] = Query(default=None)) -> list[IncidentOut]:
    return [IncidentOut.model_validate(dict(row)) for row in incidents.list_incidents(app_id)]


@app.post(
    "/api/v1/incidents/{incident_id}/resolve",
    status_code=204,
    dependencies=[Depends(_require_write_token)],
)
def resolve_incident(incident_id: int, payload: ResolveIncidentIn) -> None:
    incidents.resolve_incident(incident_id, notes=payload.notes)


@app.get("/api/v1/agents", response_model=list[AgentSummary])
def list_agents() -> list[AgentSummary]:
    return [AgentSummary(**agent.model_dump()) for agent in get_agents()]


@app.get("/api/v1/analytics", response_model=list[RepoActivity])
async def analytics(
    force_refresh: bool = Query(default=False),
    x_dashboard_token: Optional[str] = Header(default=None),
) -> list[RepoActivity]:
    if force_refresh:
        _require_read_token(x_dashboard_token)
    activity = await github_monitor.activity(get_repos(), force_refresh=force_refresh)
    # Private repos (titles, PRs, languages) are only shown to holders of the read token.
    if settings.dashboard_read_token and _secrets_match(
        x_dashboard_token, settings.dashboard_read_token
    ):
        return activity
    return [repo for repo in activity if not repo.private]


@app.post("/internal/ci-report", status_code=204, dependencies=[Depends(_require_internal_secret)])
def internal_ci_report(payload: CIReportIn) -> None:
    now = time.monotonic()
    last = _last_notified_at.get(payload.app_id)
    should_notify = payload.ci_status == "failure" and (
        last is None or (now - last) >= settings.coms_debounce_minutes * 60
    )

    ci_events.record_event(
        app_id=payload.app_id,
        repo=payload.repo,
        event_type=payload.event_type,
        ci_status=payload.ci_status,
        details=payload.details,
        notified=should_notify,
    )

    if should_notify:
        message = payload.details or f"[{payload.repo}] {payload.event_type}: {payload.ci_status}"
        notify.send_coms_notification(settings, message)
        _last_notified_at[payload.app_id] = now


@app.get(
    "/api/v1/coms", response_model=list[CIEventOut],
    dependencies=[Depends(_require_read_token)],
)
def list_coms_events(app_id: Optional[str] = Query(default=None)) -> list[CIEventOut]:
    return [
        CIEventOut(**{**dict(row), "notified": bool(row["notified"])})
        for row in ci_events.list_events(app_id)
    ]


@app.get("/api/v1/runbooks/{app_id}", response_class=PlainTextResponse)
def get_runbook(app_id: str) -> str:
    runbook_path = Path(settings.runbooks_dir).resolve() / f"{app_id}.md"
    if not runbook_path.is_file():
        raise HTTPException(404, "No runbook has been written for this app yet.")
    return runbook_path.read_text(encoding="utf-8")


@app.post(
    "/internal/second-brain/sync",
    status_code=204,
    dependencies=[Depends(_require_internal_secret)],
)
def second_brain_sync(payload: SecondBrainSyncIn) -> None:
    second_brain_store.replace_all(payload.meta, [n.model_dump() for n in payload.notes])
    metrics_store.record_run("second-brain", ok=True)


# --- Private news feed and daily digest -------------------------------------------------


class NewsStateIn(BaseModel):
    state: Literal["new", "read", "saved", "dismissed"]


@app.get("/api/v1/personal/news", dependencies=[Depends(_require_read_token)])
def personal_news_list(
    topic: Optional[str] = Query(default=None),
    state: Optional[Literal["new", "read", "saved", "dismissed"]] = Query(default=None),
) -> dict:
    if topic and topic not in personal_news.TOPICS:
        raise HTTPException(422, "Unknown topic.")
    return {
        "topics": personal_news.TOPICS,
        "items": personal_store.list_items(topic=topic, state=state),
        "sources": personal_store.list_feeds(),
        "freshness_at": personal_store.freshness_at(),
    }


@app.post("/api/v1/personal/news/refresh", dependencies=[Depends(_require_read_token)])
def personal_news_refresh() -> dict:
    personal_news.refresh()
    return {"freshness_at": personal_store.freshness_at()}


@app.post(
    "/api/v1/personal/news/{item_id}/state",
    status_code=204,
    dependencies=[Depends(_require_write_token)],
)
def personal_news_state(item_id: int, payload: NewsStateIn) -> None:
    if not personal_store.set_state(item_id, payload.state):
        raise HTTPException(404, "Unknown article.")


def _refresh_row(provider: str) -> dict:
    return next((r for r in personal_store.sports_refreshes() if r["provider"] == provider), {})


@app.get("/api/v1/personal/sports", dependencies=[Depends(_require_read_token)])
def personal_sports_list(
    league: Optional[Literal["NFL", "NBA", "MLB", "NCAAF", "NCAAB"]] = Query(default=None),
    team: Optional[str] = Query(default=None, max_length=60),
    conference: Optional[str] = Query(default=None, max_length=60),
    top_25_only: bool = Query(default=False),
    date_from: Optional[str] = Query(default=None, max_length=32),
    date_to: Optional[str] = Query(default=None, max_length=32),
) -> dict:
    result = personal_sports.query(league, team, conference, top_25_only, date_from, date_to)
    now = datetime.now(timezone.utc)
    refresh = _refresh_row("sports")
    return {
        **result,
        "priority": personal_sports.priority_events(now),
        "priority_teams": personal_sports.PRIORITY_TEAMS,
        "official_links": personal_sports.OFFICIAL_LINKS,
        "configured": personal_sports.PROVIDER is not None,
        "freshness_at": refresh.get("last_ok_at"),
        "last_error": refresh.get("last_error"),
    }


@app.post("/api/v1/personal/sports/refresh", dependencies=[Depends(_require_read_token)])
def personal_sports_refresh() -> dict:
    return {"result": personal_sports.refresh()}


class ShoeWatchIn(BaseModel):
    kind: Literal["search", "release", "stockx"]
    name: str = Field(min_length=1, max_length=120)
    keywords: str = Field(default="", max_length=200)
    size: Optional[str] = Field(default=None, max_length=20)
    condition: Optional[str] = Field(default=None, max_length=40)
    max_price: Optional[float] = Field(default=None, ge=0)
    url: Optional[str] = Field(default=None, max_length=500, pattern=r"^https?://")

    @model_validator(mode="after")
    def _stockx_size(self) -> "ShoeWatchIn":
        if self.kind == "stockx" and self.size not in personal_stockx.SIZES:
            raise ValueError("StockX watches track size 10 or 10.5 only.")
        return self


@app.get("/api/v1/personal/shoes", dependencies=[Depends(_require_read_token)])
def personal_shoes_list() -> dict:
    listings = personal_store.list_listings()
    return {
        "watches": personal_store.list_watches(),
        "listings": [{**x, "history": personal_store.price_history(x["id"])} for x in listings],
        "configured": bool(personal_shoes.PROVIDER or personal_shoes.STOCKX_PROVIDER),
        "freshness_at": _refresh_row("shoes").get("last_ok_at"),
    }


@app.post("/api/v1/personal/shoes/refresh", dependencies=[Depends(_require_read_token)])
def personal_shoes_refresh() -> dict:
    return {"result": personal_shoes.refresh()}


@app.post(
    "/api/v1/personal/shoes/watches", status_code=201, dependencies=[Depends(_require_write_token)]
)
def personal_shoes_create(payload: ShoeWatchIn) -> dict:
    return {"id": personal_store.create_watch(payload.model_dump())}


@app.delete(
    "/api/v1/personal/shoes/watches/{watch_id}",
    status_code=204,
    dependencies=[Depends(_require_write_token)],
)
def personal_shoes_archive(watch_id: int) -> None:
    if not personal_store.archive_watch(watch_id):
        raise HTTPException(404, "Unknown watch.")


def _connection_rows() -> list[dict]:
    known = set(personal_connect.SPECS) | set(personal_own.FETCHERS)
    providers = sorted(known | {"ebay", "stockx"})
    return [
        {
            "provider": p,
            "available": p in personal_connect.SPECS and bool(settings.token_encryption_key),
            "connected": personal_store.get_connection(p) is not None,
        }
        for p in providers
    ]


@app.get("/api/v1/personal/connections", dependencies=[Depends(_require_read_token)])
def personal_connections() -> dict:
    return {"connections": _connection_rows()}


@app.get("/api/v1/personal/own", dependencies=[Depends(_require_read_token)])
def personal_own_list(
    kind: Optional[Literal["purchase", "watch", "bid", "listing", "sale"]] = Query(default=None),
) -> dict:
    return {"items": personal_store.list_own_items(kind), "connections": _connection_rows()}


@app.post("/api/v1/personal/own/refresh", dependencies=[Depends(_require_read_token)])
def personal_own_refresh() -> dict:
    return {"results": personal_own.refresh(settings.token_encryption_key)}


@app.get("/api/v1/personal/connect/{provider}", dependencies=[Depends(_require_write_token)])
def personal_connect_start(provider: str) -> dict:
    try:
        url = personal_connect.authorize_link(
            provider, settings.token_encryption_key, settings.public_base_url
        )
    except personal_connect.ConnectError:
        raise HTTPException(501, "This provider is not configured for connecting.") from None
    return {"url": url}


@app.get("/api/v1/personal/connect/{provider}/callback")
def personal_connect_callback(provider: str, code: str = "", state: str = "") -> PlainTextResponse:
    # Called by the browser after the provider redirects back, so it cannot carry a token
    # header; the signed, short-lived state (issued only to a write-token holder) authorizes it.
    try:
        personal_connect.complete(
            provider, code, state, settings.token_encryption_key, settings.public_base_url
        )
    except personal_connect.ConnectError:
        return PlainTextResponse("Connection failed. Start again from the dashboard.", 400)
    return PlainTextResponse("Connected. You can close this tab and return to the dashboard.")


@app.delete(
    "/api/v1/personal/connections/{provider}",
    status_code=204,
    dependencies=[Depends(_require_write_token)],
)
def personal_disconnect(provider: str) -> None:
    if not personal_store.delete_connection(provider):
        raise HTTPException(404, "Not connected.")


@app.post("/internal/daily-digest/send", dependencies=[Depends(_require_internal_secret)])
def daily_digest_send(dry_run: bool = Query(default=False)) -> dict:
    return personal_digest.run(
        dry_run=dry_run,
        send=lambda subject, text, html: send_email(settings, subject, text, html),
    )


@app.post("/internal/game-reminders/send", dependencies=[Depends(_require_internal_secret)])
def game_reminders_send(dry_run: bool = Query(default=False)) -> dict:
    return personal_sports.send_reminders(
        datetime.now(timezone.utc),
        dry_run=dry_run,
        send=lambda message: notify.send_coms_notification(settings, message),
    )


# (setting, label, what it enables). Values are never returned, only whether each is set.
_CONFIG_CHECKS = (
    ("dashboard_read_token", "Dashboard read token", "Knowledge, financials, deployments, logs"),
    ("dashboard_write_token", "Dashboard write token", "Resolving incidents"),
    ("internal_report_secret", "Internal report secret", "Push jobs and heartbeats"),
    ("fly_api_token", "Fly API token", "Deployments and logs tabs"),
    ("github_token", "GitHub token", "Repo, PR and CI data (rate limits without it)"),
    ("resend_api_key", "Resend API key", "Email alerts"),
    ("alert_to_email", "Alert recipient", "Email alerts"),
    ("ntfy_topic", "ntfy topic", "CI push notifications"),
    ("token_encryption_key", "Token encryption key", "Connecting eBay/StockX accounts"),
    ("ebay_client_id", "eBay client ID", "Shoe price search"),
    ("ebay_client_secret", "eBay client secret", "Shoe price search"),
    ("portfolio_metrics_token", "Portfolio metrics token", "Portfolio app metrics"),
)


@app.get("/api/v1/config-status", dependencies=[Depends(_require_read_token)])
def config_status() -> dict:
    items = [
        {
            "key": key, "label": label, "used_for": used_for,
            "configured": bool(getattr(settings, key)),
        }
        for key, label, used_for in _CONFIG_CHECKS
    ]
    items.append({
        "key": "health_poll_interval_seconds", "label": "Health poller",
        "used_for": "Records health history without anyone viewing the dashboard",
        "configured": settings.health_poll_interval_seconds > 0,
    })
    return {"profile": settings.profile, "items": items}


@app.get("/api/v1/automations", dependencies=[Depends(_require_read_token)])
def automations_status() -> list[dict]:
    return automations.snapshot(settings.health_poll_interval_seconds)


@app.get("/api/v1/automations/{automation_id}/runs", dependencies=[Depends(_require_read_token)])
def automation_runs(automation_id: str) -> list[dict]:
    runs = automations.runs(automation_id)
    if runs is None:
        raise HTTPException(404, f"Unknown automation '{automation_id}'.")
    return runs


@app.get("/api/v1/second-brain/summary", dependencies=[Depends(_require_read_token)])
def second_brain_summary() -> dict:
    return second_brain_store.summary() or {"counts": {}, "pushed_at": None}


@app.get("/api/v1/second-brain/notes", dependencies=[Depends(_require_read_token)])
def second_brain_notes(q: str = "", folder: str = "") -> list[dict]:
    return second_brain_store.list_notes(q, folder)


@app.get("/api/v1/second-brain/portals", dependencies=[Depends(_require_read_token)])
def second_brain_portals() -> list[dict]:
    return second_brain_store.portals()


@app.get("/api/v1/second-brain/graph", dependencies=[Depends(_require_read_token)])
def second_brain_graph() -> dict:
    return second_brain_store.graph()


@app.get("/api/v1/second-brain/notes/{path:path}", dependencies=[Depends(_require_read_token)])
def second_brain_note(path: str) -> dict:
    note = second_brain_store.get_note(path)
    if note is None:
        raise HTTPException(404, "No such note.")
    return note



@app.get("/api/v1/learning/module", dependencies=[Depends(_require_read_token)])
def learning_module(day: Optional[date] = None) -> dict:
    module = learning.module_for(day or learning.today())
    if module is None:
        raise HTTPException(404, "No study notes synced yet. Run scripts/second_brain_push.py.")
    return module


@app.post(
    "/api/v1/learning/progress", dependencies=[Depends(_require_write_token)]
)
def learning_progress(payload: LearningProgressIn) -> dict:
    if learning.pick(second_brain_store.paths(), payload.day) != payload.path:
        raise HTTPException(422, "That note is not the module for that day.")
    day = payload.day.isoformat()
    return {"completed_at": second_brain_store.mark_studied(day, payload.path)}

frontend_dist = Path(settings.frontend_dist).resolve()
if frontend_dist.is_dir():
    assets = frontend_dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str) -> FileResponse:
        from .frontend_files import frontend_response

        return frontend_response(frontend_dist, path)
