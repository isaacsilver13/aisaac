from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

HealthState = Literal["up", "slow", "degraded", "down", "unavailable", "stale"]
CheckKind = Literal["json", "page"]
MonitorTarget = Literal["health", "page", "push"]


class AppDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    category: str
    description: str
    product_url: Optional[HttpUrl] = None
    health_url: Optional[HttpUrl] = None
    readiness_url: Optional[HttpUrl] = None
    metrics_url: Optional[HttpUrl] = None
    check_kind: CheckKind = "json"
    monitor_target: MonitorTarget = "health"
    metric_allowlist: tuple[str, ...] = ()
    # Name of the Settings field holding a read-only token for `metrics_url`, sent as
    # X-Metrics-Token to that URL only. Unset token = metrics skipped, not an outage.
    metrics_token_setting: Optional[str] = None
    timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    enabled: bool = True
    # Fly app that hosts this service; enables the Deployments tab (needs FLY_API_TOKEN).
    fly_app: Optional[str] = Field(default=None, pattern=r"^[a-z0-9-]+$")
    # Extra Fly app / Neon project names whose pushed costs belong to this app (the id and
    # fly_app already match).
    cost_aliases: tuple[str, ...] = ()


StackNodeKind = Literal["ui", "api", "job", "database", "provider"]


class StackNode(BaseModel):
    """One box on the Stack tab's flow map. Nodes sharing `host` render inside one boundary."""

    model_config = ConfigDict(frozen=True)

    kind: StackNodeKind
    name: str
    tech: str
    host: Optional[str] = None
    detail: str = ""


class AppStack(BaseModel):
    model_config = ConfigDict(frozen=True)

    description: str
    region: Optional[str] = None
    nodes: tuple[StackNode, ...]
    monitoring: str


class AppInfo(BaseModel):
    """Public registry view for the Applications page and Stack tab. Never token setting names."""

    id: str
    name: str
    category: str
    description: str
    product_url: Optional[HttpUrl] = None
    health_url: Optional[HttpUrl] = None
    readiness_url: Optional[HttpUrl] = None
    metrics_url: Optional[HttpUrl] = None
    monitor_target: MonitorTarget
    fly_app: Optional[str] = None
    stack: Optional[AppStack] = None


class CheckResult(BaseModel):
    app_id: str
    name: str
    category: str
    description: str
    product_url: Optional[HttpUrl] = None
    state: HealthState
    checked_at: datetime
    response_ms: Optional[float] = None
    http_status: Optional[int] = None
    readiness: Optional[HealthState] = None
    provider_state: Optional[str] = None
    freshness: Optional[datetime] = None
    page_state: Optional[HealthState] = None
    metrics_state: Optional[HealthState] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    detail: Optional[str] = None
    cached: bool = False


class DashboardResponse(BaseModel):
    profile: str
    refreshed_at: datetime
    results: list[CheckResult]


class PushReportIn(BaseModel):
    app_id: str = Field(pattern=r"^[a-z0-9-]+$")
    status: str = "ok"
    metrics: dict[str, Any] = Field(default_factory=dict)


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: str
    failure_type: str
    started_at: str
    resolved_at: Optional[str] = None
    notes: Optional[str] = None


class ResolveIncidentIn(BaseModel):
    notes: Optional[str] = None


CiStatus = Literal["success", "failure", "in_progress", "unknown"]


class RepoDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    category: str
    owner: str
    repo: str
    stale_days: int = Field(default=14, gt=0)
    enabled: bool = True
    # Facts filled in from GitHub's repo listing; private repos are only served with the
    # dashboard read token.
    private: bool = False
    description: Optional[str] = None
    language: Optional[str] = None
    pushed_at: Optional[datetime] = None


class PullRequestSummary(BaseModel):
    number: int
    title: str
    url: str
    opened_at: datetime
    stale: bool = False


class PullRequestDates(BaseModel):
    opened_at: datetime
    merged_at: Optional[datetime] = None


class CommitWeek(BaseModel):
    week: datetime  # Sunday 00:00 UTC that starts the week
    days: list[int]  # commits per day, Sunday first


class RepoActivity(BaseModel):
    repo_id: str
    name: str
    category: str
    owner: str
    repo: str
    ci_status: CiStatus = "unknown"
    open_issue_count: Optional[int] = None
    open_pr_count: Optional[int] = None
    open_pull_requests: list[PullRequestSummary] = Field(default_factory=list)
    commits_last_7d: Optional[int] = None
    last_commit_at: Optional[datetime] = None
    checked_at: datetime
    cached: bool = False
    detail: Optional[str] = None
    private: bool = False
    description: Optional[str] = None
    language: Optional[str] = None
    pushed_at: Optional[datetime] = None
    languages: dict[str, int] = Field(default_factory=dict)
    commit_weeks: list[CommitWeek] = Field(default_factory=list)
    pull_request_history: list[PullRequestDates] = Field(default_factory=list)


class AgentDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    domain: str
    description: str
    scope: tuple[str, ...] = ()


class AgentSummary(BaseModel):
    id: str
    name: str
    domain: str
    description: str
    scope: tuple[str, ...] = ()
    last_run_at: Optional[datetime] = None
    last_run_note: Optional[str] = None


class CIReportIn(BaseModel):
    app_id: str = Field(pattern=r"^[a-z0-9-]+$")
    repo: str
    event_type: str
    ci_status: CiStatus = "unknown"
    details: str = ""


class CIEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    app_id: str
    repo: str
    event_type: str
    ci_status: CiStatus
    details: str
    received_at: str
    notified: bool


class UsageWindow(BaseModel):
    used_pct: float = Field(ge=0, le=100)
    resets_at: datetime


class ClaudeUsageIn(BaseModel):
    session: UsageWindow
    weekly: UsageWindow


class CodexUsageIn(BaseModel):
    """Account usage windows reported by the local Codex app-server."""

    primary: UsageWindow
    secondary: Optional[UsageWindow] = None
    plan_type: Optional[str] = None


class ProviderCostIn(BaseModel):
    period: str = Field(description="Billing month, e.g. 2026-09")
    total_usd: float = Field(ge=0)
    by_app: dict[str, float] = Field(default_factory=dict)
    estimated: bool = Field(
        default=True,
        description="True when per-app figures are estimates rather than invoice lines.",
    )
    machine_hours: dict[str, float] = Field(
        default_factory=dict, description="Measured machine run time per Fly app"
    )
    invoice_total_usd: Optional[float] = Field(
        default=None, ge=0, description="Month-to-date total typed in from the billing page"
    )


class NeonUsageIn(BaseModel):
    period: str = Field(description="Billing period label, e.g. 2026-09")
    total_compute_hours: float = Field(ge=0)
    by_app: dict[str, float] = Field(default_factory=dict, description="Compute hours per project")
    plan: Optional[str] = Field(default=None, description="Neon plan id, e.g. free_v3")
    free_hours_per_project: Optional[float] = Field(
        default=None, ge=0, description="Free-plan compute allowance per project"
    )


class ClaudeUsageOut(ClaudeUsageIn):
    reported_at: datetime


class CodexUsageOut(CodexUsageIn):
    reported_at: datetime


class ProviderCostOut(ProviderCostIn):
    reported_at: datetime


class NeonUsageOut(NeonUsageIn):
    reported_at: datetime


class HostingCostRow(BaseModel):
    """One registry app's Fly + Neon figures (or an unmapped Fly app / Neon project)."""

    key: str
    name: str
    fly_usd: Optional[float] = None
    fly_hours: Optional[float] = None
    neon_usd: Optional[float] = Field(
        default=None, description="0 on Neon Free; None when the plan is unknown or paid"
    )
    neon_hours: Optional[float] = None
    neon_allowance_pct: Optional[float] = None
    total_usd: float = 0.0


class FinancialSnapshot(BaseModel):
    claude: Optional[ClaudeUsageOut] = None
    codex: Optional[CodexUsageOut] = None
    neon: Optional[NeonUsageOut] = None
    fly: Optional[ProviderCostOut] = None
    hosting: list[HostingCostRow] = Field(default_factory=list)
    hosting_total_usd: Optional[float] = None
    detail: Optional[str] = None


class NoteIn(BaseModel):
    path: str = Field(pattern=r"^(wikis|knowledge|projects|questions)/.+\.md$")
    folder: str
    title: str
    aliases: list[str] = []
    status: Optional[str] = None
    body: str
    frontmatter: dict[str, str] = {}


class SecondBrainSyncIn(BaseModel):
    """Whole-vault sync. `meta` holds card figures (last commit, drafts, broken links)."""

    meta: dict[str, Any] = {}
    notes: list[NoteIn]


class LearningProgressIn(BaseModel):
    """Marks one day's learning module done. `path` must be that day's rotation pick."""

    day: date
    path: str
