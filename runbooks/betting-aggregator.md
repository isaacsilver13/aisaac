# Runbook: Betting Aggregator

## `provider_status` shows `error` or `stale`
1. Check `/api/v1/health/metrics` for `quota_remaining` — if near zero, The Odds API's free-tier
   quota is exhausted for the billing period. The cache will keep serving the last good snapshot
   (`stale: true`) until quota resets or the TTL allows a refresh.
2. Check `fly logs -a bet-watch` for `ProviderAuthError` (key rotated/revoked) or
   `ProviderRateLimitError` (429s — quota exhausted mid-request).

## Player props showing empty
- Confirm the live provider is actually requesting prop markets: this was a real bug (fixed
  2026-09) where `SPORT_MARKETS`/`SPORT_PLAYER_PROP_MARKETS` in `the_odds_api/client.py` didn't
  include prop keys. If it regresses, check those constants first before assuming an upstream
  API change.

## Database errors on release (`alembic upgrade head` failing)
- This app uses Neon Free Postgres with the async `asyncpg` driver for the app and sync `psycopg`
  for Alembic, from the same `DATABASE_URL`. If you rotate the Neon connection string, keep the
  `+asyncpg` driver prefix and `ssl=require` (not `sslmode`) — `psycopg`'s uses `sslmode` instead
  and `env.py` already translates it; see the fix commit from 2026-09 if this breaks again.
