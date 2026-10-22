from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    profile: Literal["local", "production"] = "local"
    cache_ttl_seconds: float = 20.0
    request_timeout_seconds: float = 5.0
    frontend_dist: str = "../frontend/dist"

    # SRE rollout: incident history, runbooks, alerting, and push heartbeats
    # from apps that can't be polled (see docs/sre-observability-design.md
    # at the workspace root).
    incidents_db_path: str = "./aisaac_incidents.db"
    runbooks_dir: str = "../runbooks"
    resend_api_key: str = ""
    alert_from_email: str = "AIsaac <onboarding@resend.dev>"
    alert_to_email: str = ""
    internal_report_secret: str = ""
    stale_report_after_hours: float = 26.0

    # Read-only Fly token for the Deployments tab (`fly tokens create readonly`).
    fly_api_token: str = ""

    github_token: str = ""
    github_cache_ttl_seconds: float = 300.0

    # Coms rollout: push CI/PR/issue status from a GitHub Actions workflow,
    # recorded as history and (debounced) forwarded to ntfy.sh.
    ntfy_topic: str = ""
    coms_debounce_minutes: float = 10.0
    ci_events_db_path: str = "./aisaac_ci_events.db"

    # Financial figures (Claude/Codex usage, Neon/Fly costs) are pushed by external
    # jobs via /internal/metrics/{source}; reads need a separate token so a
    # browser-held token can never write.
    metrics_db_path: str = "./aisaac_metrics.db"
    dashboard_read_token: str = ""
    # Separate token for state-changing dashboard actions (resolving incidents) so a
    # browser-held read token can never write.
    dashboard_write_token: str = ""

    # Scoped read-only token for Portfolio Analysis's /health/metrics (aggregates only).
    # Deliberately NOT Portfolio's APP_TOKEN, which unlocks all of its financial data.
    portfolio_metrics_token: str = ""

    # Health check history (uptime/latency/trends). Recorded on every fresh check;
    # the optional poller (seconds, 0 = off) records without anyone viewing the
    # dashboard, but only while the Fly machine is awake.
    health_db_path: str = "./aisaac_health.db"
    health_retention_days: float = 30.0
    health_poll_interval_seconds: float = 0.0

    # Private news feed and daily-digest runs (read/write-token gated; digest via internal secret).
    personal_db_path: str = "./aisaac_personal.db"
    # Encrypts stored OAuth refresh tokens and signs connect-flow state. Unset = connecting is off.
    token_encryption_key: str = ""
    # Public base URL used to build OAuth redirect URIs (local: http://localhost:8000).
    public_base_url: str = "http://localhost:8000"
    # eBay Browse API app credentials (client-credentials flow); unset = no eBay price search.
    ebay_client_id: str = ""
    ebay_client_secret: str = ""
    # eBay user-consent: RuName (used as redirect_uri) and the scope list from Application Keys.
    ebay_runame: str = ""
    ebay_user_scopes: str = ""
    # StockX developer app (Auth0 authorization-code flow) and the x-api-key for API calls.
    stockx_client_id: str = ""
    stockx_client_secret: str = ""
    stockx_api_key: str = ""

    # Assistant brief: Google Calendar secret iCal address (read-only) and gym_tracker's
    # token-guarded /api/v1/assistant/summary. Unset = that brief section says "not connected".
    google_calendar_ics_url: str = ""
    gym_tracker_url: str = ""
    gym_tracker_token: str = ""

    # Second-brain vault notes pushed by scripts/second_brain_push.py (read-token gated).
    second_brain_db_path: str = "./aisaac_second_brain.db"

    # Books agent (Groq free tier); used only by the write-token book endpoints. Unset = 503.
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"


@lru_cache
def get_settings() -> Settings:
    return Settings()
