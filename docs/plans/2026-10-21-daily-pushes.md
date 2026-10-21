# AIsaac — Toggleable daily pushes (Plan 0, foundation for Books, Philosophy and the NBA report)

Status: in progress
Scope: `repos/aisaac_dashboard` (GitHub `isaacsilver13/aisaac`). Branch from `origin/master` in a fresh worktree; the
local checkout is on `fix/chess-lint`.

Related: [books](2026-10-21-aisaac-books-agent.md), [philosophy](2026-10-21-philosophy-practice.md),
[NBA report](2026-10-21-nba-daily-report.md), [Fly renames](2026-10-21-fly-app-renames.md).

## Goal

One small mechanism every daily push uses: each kind is a toggle in Settings, sends at most once per America/Chicago
day, and is fired by one external cron job.

## Constraints and non-goals

- Pushes go through the existing ntfy sender (`backend/app/notify.py` `send_coms_notification`); no new channel.
- Schedules are never activated by code (the house rule from `CLAUDE.md`); Isaac creates the cron-job.org job.
- All kinds default to **off**.
- Non-goal: per-kind custom send hours in the UI. Hours are constants; add a picker when one is actually wanted.

## Approach

1. `backend/app/personal_store.py`: add
   `CREATE TABLE IF NOT EXISTS push_prefs (kind TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)` and
   `get_push_prefs()` / `set_push_pref(kind, enabled)`. Additive only, like the rest of the file.
2. New `backend/app/daily_pushes.py`:
   - `PUSHES: dict[str, tuple[int, Callable[[date], str | None]]]` maps kind → (send hour in CT, message builder).
   - `run(now)`: for each enabled kind whose hour has passed today (CT), if `not personal_store.reminded(f"{kind}:{date}")`,
     build the message; `None` means "not ready, try next hour" (e.g. the NBA report hasn't arrived). Otherwise
     `send_coms_notification`, then `mark_reminded` only if ntfy accepted it. This reuses the existing `reminders_sent`
     once-only table (`personal_store.py:456/463`) — no new claim logic.
3. `backend/app/main.py`:
   - `GET /api/v1/personal/pushes` (read token): every kind in `PUSHES` with its enabled flag and send hour.
   - `PUT /api/v1/personal/pushes/{kind}` (write token): 404 unless `kind in PUSHES`.
   - `POST /internal/daily-pushes/send` (`INTERNAL_REPORT_SECRET`, same dependency as `/internal/daily-digest/send`
     at `main.py:637`): calls `daily_pushes.run`, returns per-kind `sent|not_due|not_ready|already_sent|disabled`.
4. Frontend: "Daily pushes" card in `frontend/src/pages/Settings.tsx` (one switch per kind, write token required);
   client calls in `frontend/src/api.ts`.
5. Isaac adds a cron-job.org job: hourly, `POST <AIsaac URL>/internal/daily-pushes/send`. The machine already wakes
   every 15 min for game reminders, so Fly cost is ~unchanged. **Add this job to the "consumers of the URL" list in
   the Fly-renames plan** (AIsaac moves `aisaac-dashboard` → `aisaac`).
6. Docs: `CLAUDE.md` (new endpoints, table), `scripts/README.md` (the cron job).

## Verification

- Automated (pytest, `backend/`): disabled kind never sends; enabled kind sends once per CT day, second call
  `already_sent`; nothing before its hour; builder returning `None` leaves it unmarked; failed ntfy leaves it
  unmarked; PUT unknown kind → 404; endpoints enforce read/write/internal auth. `ruff check .`.
- Automated (frontend): vitest for the toggle card; `npm run lint`, `npm run build`.
- Manual: run locally with `NTFY_TOPIC` unset, toggle a kind on, `curl -X POST` the internal endpoint, see the
  "not sent, no ntfy topic" log line; call again, see `already_sent`.

## Risks / decisions needed

- None blocking. If ntfy is down at the send hour, the next hourly call retries (unmarked on failure).
