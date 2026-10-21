# AIsaac — Scheduled refresh (refresh on a schedule, not on open)

Status: complete (2026-10-21, branch claude/scheduled-refresh-e2cf23)
Scope: `repos/aisaac_dashboard` (GitHub `isaacsilver13/aisaac`) only. This is section 4b of the workspace plan
`docs/plans/2026-10-21-scheduled-refresh.md`; 4a (bet_watch) shipped separately.

Related: [daily pushes](2026-10-21-daily-pushes.md), Fly renames (workspace `docs/plans/2026-10-21-fly-app-renames.md`).

## Goal

Personal data refreshes on a schedule; opening a page only reads stored data; every existing Refresh button still
refreshes on demand.

## Constraints and non-goals

- AIsaac scales to zero on Fly, so no in-process scheduler: an external cron-job.org call, like the digest. Schedules
  are never activated by code; Isaac creates the job.
- The app is being renamed `aisaac-dashboard` → `aisaac`; the new job is listed among that plan's URL consumers.
- Non-goals: Command Center health checks and GitHub activity (live status is their purpose; already cached 300s).

## Approach

1. `POST /internal/personal/refresh` (`INTERNAL_REPORT_SECRET`): best-effort, per-source isolated calls to
   `personal_news.refresh`, `personal_sports.refresh`, `personal_shoes.refresh`, `personal_own.refresh`, then a
   rebuild of the Assistant brief stored in `personal_store.assistant_snapshot` (additive, one row). Returns a short
   code per source. Each run is logged to `metrics_store.push_runs` (`personal-refresh`; failures as
   `source:code`); a fully ok run also stores its codes as the `personal-refresh` snapshot, which the new
   Automations row ("Personal feeds refresh", stale after 7h to cover the overnight gap) reads as its last run.
2. Remove on-open refresh:
   - News: the `STALE_NEWS_MS` auto-POST in `fetchNews` is gone; `forceRefresh` only from the button.
   - Assistant: `GET /api/v1/personal/assistant` serves the stored snapshot (builds and stores once if none);
     `?force_refresh=true` rebuilds live and replaces it. The page's Refresh button now forces.
   - Unchanged: the News/Sports/Shoes/Own refresh endpoints and buttons.
   - Daily digest: still builds its own fresh brief (it runs once a day and must show today's calendar, not a
     snapshot that may predate midnight) and still refreshes news/sports/shoes itself.
3. Isaac adds a cron-job.org job: hourly 06:00–24:00 America/Chicago → `POST <AIsaac URL>/internal/personal/refresh`
   with `X-Internal-Secret`.
4. Docs: `CLAUDE.md`, `scripts/README.md`, `docs/personal-feeds-providers.md`.

## Verification record (2026-10-21)

- Backend: `pytest` 226 passed (new `tests/test_personal_refresh.py`: secret required; all sources run, brief built
  last and stored; one raising source leaves the others ok and logs `sports:error` → Automations `failing`; GET
  serves the snapshot without calling the calendar fetch; GET with no snapshot builds once; `force_refresh`
  rebuilds and replaces). `ruff check .` clean.
- Frontend: `npm run lint` clean, `npm run test` 153 passed (News makes no POST on open even with an old snapshot,
  Refresh POSTs; Assistant reads `/assistant` on open, Refresh requests `?force_refresh=true`), `npm run build` ok.
- Manual (local uvicorn serving the built frontend, temp DBs): opening News and Assistant made only
  `GET /api/v1/personal/news` and `GET /api/v1/personal/assistant` (News had never refreshed, which the old code
  would have auto-POSTed). Assistant Refresh → `GET …/assistant?force_refresh=true`; News Refresh →
  `POST …/news/refresh` then GET. `POST /internal/personal/refresh` without the secret → 401; with it →
  `{"news":"ok","sports":"ok","shoes":"not_configured","own":"ok","assistant":"ok"}` against live RSS/ESPN, and
  the Automations row showed `ok`.
