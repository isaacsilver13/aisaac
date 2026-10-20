# AIsaac Dashboard

A standalone links and health dashboard for Isaac's applications.

## Structure

- `backend/` contains the FastAPI monitor and normalized health contract.
- `frontend/` contains the React dashboard.

The monitor checks configured public endpoints server-side. It does not access another application's database, local artifacts, authenticated data, or user financial data.

## Pages

| Route | What it shows |
|---|---|
| `/` | Overview: system status, attention items, activity, financials, second-brain summary. |
| `/applications/:id/{overview,stack,health,deployments,data,logs}` | Per-app tabs. Stack maps the observed request, deployment, data/provider, and monitoring flow; Health has uptime, latency and state history; Deployments and Logs read Fly; Data shows reported metrics and their history. |
| `/github`, `/github/repositories[/:repo]` | Repo activity, repository list and per-repo detail. |
| `/assistant` | Personal brief (token-gated): today's calendar, priority-team games, projects that need attention with where you left off, gym progress. |
| `/tasks` | Open pull requests and unresolved incidents. |
| `/automations` | Last run and staleness of push jobs and background tasks (observed, not scheduled). |
| `/knowledge[/*]` | Second-brain vault as a Wikipedia-style viewer (token-gated): wiki portals, articles with infobox, contents, hover previews, backlinks and a local graph; `/knowledge/<note path>`, `/knowledge/<wiki>` (portal), `/knowledge/graph`, `/knowledge/all`. |
| `/settings` | Dashboard token, backend configuration status, theme. |

Light and dark themes (tokens in `frontend/src/theme/theme.css`), Iconoir icons, and Motion transitions that respect `prefers-reduced-motion`.

## Configuration

Backend settings come from environment variables (`backend/app/config.py`). Secrets on Fly: `fly secrets set NAME=... -a aisaac-dashboard`. **Settings > Backend configuration** shows which of these are set, never their values.

| Variable | Enables |
|---|---|
| `DASHBOARD_READ_TOKEN` | Forced health/GitHub refreshes, communications history, knowledge, financials, deployments, logs, automations, config status (sent as `X-Dashboard-Token`). |
| `DASHBOARD_WRITE_TOKEN` | Resolving incidents (sent as `X-Dashboard-Write-Token`; keep distinct from the read token). Incident listing needs the read token. |
| `INTERNAL_REPORT_SECRET` | Push jobs and heartbeats (`/internal/*`). |
| `FLY_API_TOKEN` | Deployments and Logs tabs. Read-only org token: `fly tokens create readonly personal`. |
| `GITHUB_TOKEN` | Repo, PR and CI data. |
| `RESEND_API_KEY`, `ALERT_TO_EMAIL` | Email alerts. |
| `NTFY_TOPIC` | CI pushes, pre-game reminders and the morning brief push. |
| `GOOGLE_CALENDAR_ICS_URL` | Assistant: today's events (Google Calendar → Integrate calendar → secret iCal address). |
| `GYM_TRACKER_URL`, `GYM_TRACKER_TOKEN` | Assistant: gym progress from gym_tracker's `/api/v1/assistant/summary`. |
| `HEALTH_POLL_INTERVAL_SECONDS` | Optional in-process poller (default 0 = off). |

To report Codex included usage, schedule `python scripts/push_codex_usage.py` every two hours on
the signed-in Codex machine. It uses the local Codex app-server and the same AIsaac push settings
as the other scripts; run it once with `--dry-run` before scheduling.

### Connect GitHub

GitHub data is fetched only by the backend; the browser never receives or stores a GitHub credential.
Create a fine-grained personal access token restricted to the repositories in
`backend/app/github_registry.py`, with read-only **Contents**, **Metadata**, **Issues**,
**Pull requests**, and **Actions** permissions. Set it as the production secret:

```powershell
fly secrets set GITHUB_TOKEN=<fine-grained-read-only-token> -a aisaac-dashboard
```

Then open **Settings** with a dashboard read token. Backend configuration will show `GitHub token`
as **Set** without revealing the token. The GitHub and repository pages can then load repository,
pull-request, and CI data.

## History

Every fresh health check is stored (status, latency, numeric metrics) in SQLite on the Fly volume (`HEALTH_DB_PATH`, 30 days). History accrues only while something checks the apps: someone viewing the dashboard, or the optional poller. Fly machines auto-stop, so expect gaps.

## Local development

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
pytest
uvicorn app.main:app --reload
```

The dashboard backend uses port `8000`. The local Vinyl API should run on
port `8003` so the two health endpoints do not collide:

```powershell
Set-Location ../vinyl_api
python -m uvicorn vinyl_api.main:app --reload --port 8003
```

In another terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

Set `PROFILE=production` only when the dashboard should check the configured production endpoints. Production never uses localhost targets.

## Contract

A monitored service should expose a public liveness endpoint returning JSON with a `status` field. Optional scalar fields are surfaced as non-sensitive metrics. Services may also expose `provider_status`, `readiness`, or freshness fields, but the dashboard treats service liveness, readiness, provider state, and data freshness as separate signals.

The Betting Aggregator local profile uses `/api/v1/health` for process
liveness and `/api/v1/status` for provider/data state. The status endpoint is
read-only and must not return odds events, offers, credentials, quotas, or raw
provider errors.

The browser cannot provide arbitrary target URLs. All targets come from the profile registry in `backend/app/registry.py`.

## Adding or changing an app's URL

Every monitored URL lives in `backend/app/registry.py`, so a URL change is a one-line edit there. Each `AppDefinition` has a `local` and a `production` entry:

| Field | What it is |
|---|---|
| `product_url` | Where the card's click-through link goes (also page-checked). |
| `health_url` | Liveness endpoint. Returns JSON with a `status` field. |
| `readiness_url` | Optional. Readiness, tracked separately from liveness. |
| `metrics_url` + `metric_allowlist` | Optional. Only allowlisted scalar fields are shown. |

To change a URL, edit it in `registry.py`, then check it:

```powershell
Set-Location backend
python -m scripts.check_urls              # pings every URL in the production profile
python -m scripts.check_urls --profile local
python -m scripts.check_urls --ipv4       # if IPv6 to fly.dev is flaky on your network
```

The script prints `PASS` / `SLOW` / `FAIL` per URL and exits non-zero if any fail. `tests/test_registry.py` also guards against reintroducing retired hostnames.

To add an app, add an `AppDefinition` to both profiles (use `monitor_target="push"` for apps that report in with a heartbeat instead of exposing a public URL). Setting `enabled=False` on an entry stops it being checked and shows its card as "Not configured"; to remove an app from the dashboard entirely, delete its entry from that profile.

Most apps are single-container Fly apps, so their UI and API share one host. Vinyl is the exception (`vinyl-catalog` UI, `vinyl-api` API).

## Cold starts

Fly machines scale to zero. Each health check has a 10s timeout and retries once (connection error, timeout, or a 502/503/504) before an app is marked `down`. A response that needed the retry, or took more than about 8s, shows as **Slow / waking up** instead of down. A `down` card shows the error and the time of the last check.

## Current limitations

NBA Prediction is push-based (heartbeat only) and has no product URL in the production profile. The `local` profile still points at localhost ports and only works when those apps are running.
