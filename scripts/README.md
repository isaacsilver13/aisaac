# Push scripts

These run outside the dashboard and push figures to `POST /internal/metrics/{source}`.
The dashboard holds no Claude, Codex, Neon or Fly credentials.

## One-time setup

1. On the dashboard's Fly app, set `INTERNAL_REPORT_SECRET` (write) and `DASHBOARD_READ_TOKEN`
   (read, the token you type into the Command Center once).
2. Create `~/.claude/aisaac_push.json` (or export the same env vars):

   ```json
   { "AISAAC_DASHBOARD_URL": "https://aisaac-dashboard.fly.dev", "AISAAC_INTERNAL_SECRET": "<INTERNAL_REPORT_SECRET>" }
   ```

## Claude session / weekly usage — `claude_statusline_push.py`

Registered as the Claude Code `statusLine` command in `~/.claude/settings.json`. Claude Code pipes
`rate_limits` (`five_hour` / `seven_day`: `used_percentage`, `resets_at`) to it; it prints
`5h 12% | 7d 55%` and pushes at most every 5 minutes. Only updates while a Claude Code session is
open, and only on Pro/Max plans.

## Codex account usage — `push_codex_usage.py`

Reads the signed-in local Codex app-server's included-usage windows and pushes a normalized
snapshot. Schedule `python scripts/push_codex_usage.py` every two hours on the machine that runs
Codex. Use `--dry-run` to verify the local Codex connection before scheduling it. The script sends
only window percentages, reset times, and the plan label; it does not send credentials or account IDs.

## Neon compute hours per project — `push_neon_usage.py`

Neon's API reports usage, not dollars. Needs `NEON_API_KEY` (and `NEON_ORG_ID` for org projects).
Tries the v2 consumption endpoint, then the legacy one, then the per-project counters. It also
pushes the account plan (read from the API, or `--plan free`); on Free the dashboard shows $0 and
each project's hours as a share of the 100 CU-hour allowance. Schedule daily:
`python scripts/push_neon_usage.py` (`--dry-run` to preview).

## Fly.io cost per app — `push_fly_costs.py`

Fly has no billing API, so per-app dollars are **estimates**: each machine's measured run time from
Fly's managed Prometheus (`fly_instance_up`, 15s samples) × its size at published rates, plus
volumes and dedicated IPv4. Uses `FLY_API_TOKEN` if set (a read-only org token is enough), else your
`fly` CLI login. Not counted: stopped machines' root filesystem, egress, and non-app charges.

Prometheus keeps only recent days, so **schedule it daily**; finished days are cached in
`~/.claude/aisaac_fly_invoice.json` so the month stays complete:

```
python scripts/push_fly_costs.py [--invoice-total 10.30] [--dry-run]
```

`--invoice-total` (the month-to-date figure on Fly's billing page) is remembered for the month and
shown next to the estimate, with the gap labelled; it is never spread across apps.

Fly apps and Neon projects map to dashboard apps by registry `id`, `fly_app` or `cost_aliases`
in `backend/app/registry.py`. After the first Neon run, add an alias for any project whose name
doesn't match an app id.

## second_brain_push.py

Syncs the Obsidian vault (`wikis/`, `knowledge/`, `projects/`, `questions/`) to the dashboard's Second Brain page and Command Center card. Vault path: `SECOND_BRAIN_PATH` (default `~/second-brain`). Each note's frontmatter (type, updated, ...) is forwarded too, and scanned like the body. It aborts if any note holds a credential-shaped string. Run after committing vault changes:

    python scripts/second_brain_push.py [--dry-run]

Reads need the same dashboard token as the financials panel.

## push_project_status.py

Feeds the Assistant page's Projects card. For every git repo under `WORKSPACE_REPOS_PATH` (default
`~/nba_prediction/repos`) and each of its worktrees it sends the folder name, branch, last commit
date and subject, uncommitted file count and commits not on `origin/<default>`, plus the newest
left-off notes from `~/.claude/left-off/<repo folder>/*.md`. Full paths and file contents never
leave the machine. It runs `git fetch` first (no prompts, 20 s cap per repo; `--no-fetch` skips it).
Schedule it hourly (Windows Task Scheduler); the Automations page flags it stale after 2 hours.

    python scripts/push_project_status.py [--dry-run] [--no-fetch]

## Scheduled cron-job.org calls (no script)

The daily digest, game reminders and hourly daily pushes (`POST /internal/daily-pushes/send`) are
plain HTTP calls scheduled at cron-job.org, set up by hand. See
[docs/personal-feeds-providers.md](../docs/personal-feeds-providers.md#scheduling-manual-needs-your-approval--nothing-is-activated).
