# Personal feeds — providers, status and digest scheduling

Plan: [personal feeds and daily digest](plans/2026-10-07-personal-feeds-and-daily-digest.md).

## Shipped (stage 1)

| Area | Status | Source |
| --- | --- | --- |
| News | Live | Public RSS/Atom allowlist in `backend/app/personal_news.py` (`FEEDS`): Federal Reserve, SEC, NPR (Economy/Business/Technology/Politics), Ars Technica, arXiv (math, stat.ML), Quanta. Headlines + links only; every item links to the publisher. |
| Daily digest | Built, **not scheduled** | `personal_digest.py`, `POST /internal/daily-digest/send` |
| Sports | Live (ESPN) | `personal_sports.py` + `personal_espn.py`, `/api/v1/personal/sports`, Sports page. ESPN public scoreboard JSON, approved by Isaac 2026-10-19 as an exception (see below). Priority teams: Bears, Bulls, White Sox, Northwestern and Temple (football + basketball). |
| Game reminders | Built, **not scheduled** | `POST /internal/game-reminders/send`: one ntfy push per priority-team game, within 60 min of start |
| Shoes | **Built, no live provider** | `personal_shoes.py`, `/api/v1/personal/shoes`, Shoes page. User-managed watches and release links (write token), price-change detection with bounded history, fixture-tested. `PROVIDER` is `None` until eBay Browse production access is approved. No scraping. |
| Books | Built, needs `GROQ_API_KEY` | `personal_books.py`, `/api/v1/personal/books*`, Books page. Groq free tier (LLM, write-token endpoints only) suggests books; each is kept only if the **iTunes Search API** (`https://itunes.apple.com/search?media=audiobook`, keyless, approved in the books plan 2026-10-21) finds it as an audiobook. Audible and OverDrive/Libby get search links only, never claimed as verified. Concept maps are AI-generated outlines. Errors are short codes (`groq_not_configured`, `groq_rate_limited`, `groq_failed`, `bad_map`). The `books` daily push (9 CT, off by default) sends one map node a day from the `listening` book. |

Feed liveness was checked once on 2026-10-07 (all 10 returned HTTP 200 and parsed). Each publisher's
reuse terms still need a read before relying on this beyond personal use; the app stores only titles and URLs.
Feed fetch errors are stored as a short code (`fetch_failed` / `parse_failed`), never the upstream body.

## Digest behaviour

- The endpoint sends only when Chicago local time is >= 08:00 **and** no digest was sent for that local date
  (`digest_runs`, primary key = `America/Chicago` date). Early calls return `too_early`; repeats return
  `already_handled`; an unconfigured/failed email leaves the day retryable.
- `?dry_run=true` renders and returns the digest without sending or writing anything.
- Needs `RESEND_API_KEY`, `ALERT_TO_EMAIL`, a verified `ALERT_FROM_EMAIL`, `INTERNAL_REPORT_SECRET`.
  Resend's default `onboarding@resend.dev` sender only delivers to the Resend account owner.

## Scheduling (manual, needs your approval — nothing is activated)

Use one daily job at [cron-job.org](https://cron-job.org) instead of an hourly GitHub Actions ping:

- URL: `https://aisaac-dashboard.fly.dev/internal/daily-digest/send` (method POST)
- Header: `X-Internal-Secret: <INTERNAL_REPORT_SECRET>` — note this stores the secret with a third party;
  consider a dedicated value if you rotate it separately.
- Schedule: every day 08:00, timezone **America/Chicago** (cron-job.org handles DST).
- Timeout 30 s (a cold Fly start plus feed refresh). Enable failure notifications.
- First run `?dry_run=true`, then one manual send, then enable the schedule after a few days of review.

### Game reminders job

- URL: `https://aisaac-dashboard.fly.dev/internal/game-reminders/send` (method POST), same
  `X-Internal-Secret` header as the digest.
- Schedule: every 15 minutes. Needs `NTFY_TOPIC`. A game is pushed once, and only marked sent after
  ntfy accepts it, so a failed push retries on the next tick. The ESPN feed refreshes at most hourly.
- First run `?dry_run=true` (lists games due now, sends nothing).

### Daily pushes job

- URL: `<AIsaac URL>/internal/daily-pushes/send` (method POST), same `X-Internal-Secret` header. The host
  is the AIsaac Fly app (`aisaac-dashboard.fly.dev`, becoming `aisaac.fly.dev` after the rename), so
  update this job with the other consumers when the app moves.
- Schedule: every hour, on the hour. Needs `NTFY_TOPIC`. Each kind in `daily_pushes.PUSHES` (Settings →
  Daily pushes, all off by default) sends once per Chicago day at or after its hour; a failed or not-ready
  push retries on the next hourly call. The response lists each kind's status
  (`sent`, `failed`, `not_due`, `not_ready`, `already_sent`, `disabled`).

### Personal refresh job

- URL: `<AIsaac URL>/internal/personal/refresh` (method POST), same `X-Internal-Secret` header. Same host
  note as the daily pushes job: update it with the other consumers when the app is renamed.
- Schedule: every hour 06:00–24:00, timezone **America/Chicago**. Timeout 30 s.
- Refreshes news, sports, shoes and connected own-data, then rebuilds the Assistant brief and stores it.
  Opening News or Assistant only reads stored data; each page's Refresh button still refreshes on demand.
  The response lists each source's short code (`ok`, `not_configured`, `fetch_failed`, `error`, ...); one
  failing source never stops the others. Runs show on the Automations page ("Personal feeds refresh"),
  flagged stale after 7 hours to allow for the overnight gap.

## Provider spike (2026-10-07)

Searched, not yet verified against authoritative terms. No key was requested and no account created.

| Candidate | What was found | Decision |
| --- | --- | --- |
| ESPN scoreboard JSON | Undocumented; no published terms or limits | **Approved as an exception 2026-10-19** by Isaac: the only free source covering NFL/NBA/MLB/NCAAF/NCAAB with AP rankings, already used by NFL_Confidence. May change without notice; a failure keeps the last snapshot. Date ranges return 400, so one call per day. |
| CollegeFootballData API | Free key, shared monthly call quota (reported ~1,000/month, may have changed); terms page dated Aug 2026 permits use. Could not confirm AP Top 25 or conference data is on the free tier. NFL/NBA/MLB not covered | **Candidate for NCAAF + rankings**; confirm tier page and rankings endpoint before use |
| TheSportsDB | Free key; sources conflict on rate limit and non-commercial terms; live scores need a paid tier | **Candidate for schedules**, terms to be read first |
| balldontlie | Free tier reported at 5 req/min, games/teams only; sources conflict | **Candidate for NBA schedules**, terms to be read first |
| eBay Browse API | Requires production approval | **Blocked** pending approval |
| iTunes Search API | Keyless public JSON search (`media=audiobook`); Apple documents roughly 20 calls/min | **Allowlisted 2026-10-21** for the Books audiobook check only (at most 10 calls per recommendation request) |

To enable a source: implement a callable that returns raw event dicts (see `personal_sports.normalize` for the shape), set `PROVIDER`, add its key via the existing secret workflow, and record the verified terms here. Games with no `url` fall back to the league's official scoreboard link; rankings are stored only when the provider supplies them with a poll date, and the UI treats a poll older than 8 days as unavailable.

## Connected accounts (eBay, StockX) — scaffolding only

Built and tested with fixtures: encrypted token vault (`personal_vault.py`, Fernet keyed from
`TOKEN_ENCRYPTION_KEY`), signed-state OAuth connect flow (`personal_connect.py`), read-only own-data
storage and endpoints (`personal_own.py`, `/api/v1/personal/own`, `/connections`, `/connect/{provider}`),
the "Your accounts" panel on the Shoes page, and an eBay Browse price-search provider
(`personal_ebay.py`, app token, enabled by `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`).

**Not done — needs the providers' official docs:** `personal_connect.SPECS` (authorize/token URLs,
scopes) and `personal_own.FETCHERS` (purchase/watchlist/bid/listing endpoints) are empty, so Connect
shows "not set up" for both. The eBay Browse request shapes are unverified against the live API.

To finish a provider: read its OAuth and account-data docs, add its `ProviderSpec` and a fetcher that
returns `{kind, id, title, price, url, occurred_at}` dicts, register the redirect URL
(`PUBLIC_BASE_URL` + `/api/v1/personal/connect/<provider>/callback`) in its developer portal, and set
`TOKEN_ENCRYPTION_KEY`. Everything stays read-only: no buying, bidding, listing or orders.

## StockX (2026-10-08, from the published swagger and auth docs)

- Connect: Auth0 authorization-code flow on `accounts.stockx.com` (`audience=gateway.stockx.com`,
  scope `offline_access openid`); API calls need the bearer token plus `x-api-key`.
- Own data: active listings (asks) and sales history only. The public API has no buyer purchase
  history, watchlist or buy-side bids.
- Price tracking: a `stockx` watch (size 10 or 10.5 only) takes the first catalog search hit for its
  keywords (use a style code) and records that size's lowest ask from `/market-data`.
- Pacing: 1 request/second, 25,000/day; calls are spaced in code and the access token is cached.
- Settings: `STOCKX_CLIENT_ID`, `STOCKX_CLIENT_SECRET`, `STOCKX_API_KEY`. Not verified live.
