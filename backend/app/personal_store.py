"""Private news items, per-feed freshness and daily-digest runs.

Same SQLite-on-a-Fly-volume pattern as metrics_store.py. Migrations are
additive only (`CREATE TABLE IF NOT EXISTS`); nothing here ever drops data.
Feed state stores a short error *code*, never an upstream response body.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    topic TEXT NOT NULL,
    published_at TEXT NOT NULL,
    score REAL NOT NULL,
    why TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'new',
    first_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_topic_score ON news_items (topic, score DESC);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC);

CREATE TABLE IF NOT EXISTS news_sources (
    feed_url TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    last_ok_at TEXT,
    last_attempt_at TEXT,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS sports_events (
    id TEXT PRIMARY KEY,
    league TEXT NOT NULL,
    home TEXT NOT NULL,
    away TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    status TEXT NOT NULL,
    start_at TEXT NOT NULL,
    home_conference TEXT,
    away_conference TEXT,
    home_rank INTEGER,
    away_rank INTEGER,
    poll_date TEXT,
    url TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sports_start ON sports_events (start_at);
CREATE INDEX IF NOT EXISTS idx_sports_league ON sports_events (league, start_at);

CREATE TABLE IF NOT EXISTS sports_refreshes (
    provider TEXT PRIMARY KEY,
    last_ok_at TEXT,
    last_attempt_at TEXT,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS shoe_watches (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '',
    size TEXT,
    condition TEXT,
    max_price REAL,
    url TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shoe_listings (
    id INTEGER PRIMARY KEY,
    watch_id INTEGER NOT NULL,
    listing_key TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL,
    prev_price REAL,
    condition TEXT,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    changed_at TEXT,
    UNIQUE (watch_id, listing_key)
);

CREATE TABLE IF NOT EXISTS listing_snapshots (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL,
    price REAL,
    observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_listing ON listing_snapshots (listing_id, observed_at);

CREATE TABLE IF NOT EXISTS oauth_connections (
    provider TEXT PRIMARY KEY,
    token_enc TEXT NOT NULL,
    connected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS own_items (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL,
    url TEXT,
    occurred_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_own_kind ON own_items (kind, occurred_at DESC);

CREATE TABLE IF NOT EXISTS reminders_sent (
    event_id TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digest_runs (
    local_date TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    sent_at TEXT,
    freshness_at TEXT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS push_prefs (
    kind TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS philosophy_journal (
    local_date TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    intention TEXT,
    reflection TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_reports (
    local_date TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    built_at TEXT NOT NULL
);
"""

STATES = ("new", "saved", "dismissed")

_db_path: str = "./aisaac_personal.db"


def configure(db_path: str) -> None:
    global _db_path
    _db_path = db_path
    with _connect() as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_item(item: dict) -> None:
    """Insert a new article, or refresh score/title of a known URL; state is kept."""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO news_items (url, title, source, topic, published_at, score, why, "
            "first_seen_at) VALUES (:url, :title, :source, :topic, :published_at, :score, :why, "
            ":now) ON CONFLICT(url) DO UPDATE SET title = excluded.title, "
            "score = excluded.score, why = excluded.why",
            {**item, "now": _now()},
        )


def list_items(
    topic: Optional[str] = None, state: Optional[str] = None, limit: int = 100
) -> list[dict]:
    """Newest-score-first; dismissed items are hidden unless asked for explicitly."""
    clauses, params = [], []
    if topic:
        clauses.append("topic = ?")
        params.append(topic)
    if state:
        clauses.append("state = ?")
        params.append(state)
    else:
        clauses.append("state != 'dismissed'")
    where = " WHERE " + " AND ".join(clauses)
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM news_items{where} ORDER BY score DESC, published_at DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def set_state(item_id: int, state: str) -> bool:
    with _connect() as conn:
        return conn.execute(
            "UPDATE news_items SET state = ? WHERE id = ?", (state, item_id)
        ).rowcount == 1


def record_feed(feed_url: str, source: str, error: Optional[str]) -> None:
    """Freshness is separate from content: a failed fetch keeps `last_ok_at` and old items."""
    now = _now()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO news_sources (feed_url, source, last_ok_at, last_attempt_at, last_error) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(feed_url) DO UPDATE SET "
            "last_ok_at = COALESCE(excluded.last_ok_at, news_sources.last_ok_at), "
            "last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error",
            (feed_url, source, None if error else now, now, error),
        )


def list_feeds() -> list[dict]:
    with _connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM news_sources ORDER BY source")]


def freshness_at() -> Optional[str]:
    with _connect() as conn:
        row = conn.execute("SELECT MAX(last_ok_at) AS t FROM news_sources").fetchone()
    return row["t"]


# --- Sports ---------------------------------------------------------------------------

_EVENT_COLS = (
    "id", "league", "home", "away", "home_score", "away_score", "status", "start_at",
    "home_conference", "away_conference", "home_rank", "away_rank", "poll_date", "url",
)


def upsert_event(event: dict) -> None:
    row = {c: event.get(c) for c in _EVENT_COLS}
    cols = ", ".join(_EVENT_COLS)
    marks = ", ".join(f":{c}" for c in _EVENT_COLS)
    sets = ", ".join(f"{c} = excluded.{c}" for c in _EVENT_COLS if c != "id")
    with _connect() as conn:
        conn.execute(
            f"INSERT INTO sports_events ({cols}, updated_at) VALUES ({marks}, :now) "
            f"ON CONFLICT(id) DO UPDATE SET {sets}, updated_at = excluded.updated_at",
            {**row, "now": _now()},
        )


def list_events(
    league: Optional[str] = None,
    team: Optional[str] = None,
    conference: Optional[str] = None,
    top_25_only: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    """Filters are ANDed. A conference or Top-25 match on either team keeps the game."""
    clauses, params = [], []
    if league:
        clauses.append("league = ?")
        params.append(league)
    if team:
        clauses.append("(LOWER(home) = LOWER(?) OR LOWER(away) = LOWER(?))")
        params += [team, team]
    if conference:
        clauses.append("(home_conference = ? OR away_conference = ?)")
        params += [conference, conference]
    if top_25_only:
        clauses.append("(home_rank BETWEEN 1 AND 25 OR away_rank BETWEEN 1 AND 25)")
    if date_from:
        clauses.append("start_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("start_at < ?")
        params.append(date_to)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM sports_events{where} ORDER BY start_at LIMIT ?", (*params, limit)
        ).fetchall()
    return [dict(r) for r in rows]


def latest_poll_date() -> Optional[str]:
    with _connect() as conn:
        return conn.execute("SELECT MAX(poll_date) AS d FROM sports_events").fetchone()["d"]


def record_refresh(table: str, provider: str, error: Optional[str]) -> None:
    """Freshness is separate from content: a failed refresh keeps `last_ok_at` and old rows."""
    now = _now()
    with _connect() as conn:
        conn.execute(
            f"INSERT INTO {table} (provider, last_ok_at, last_attempt_at, last_error) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET "
            f"last_ok_at = COALESCE(excluded.last_ok_at, {table}.last_ok_at), "
            "last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error",
            (provider, None if error else now, now, error),
        )


def sports_refreshes() -> list[dict]:
    with _connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM sports_refreshes")]


# --- Shoes ----------------------------------------------------------------------------

MAX_SNAPSHOTS = 60  # bounded price history per listing


def create_watch(w: dict) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO shoe_watches (kind, name, keywords, size, condition, max_price, url, "
            "created_at) VALUES (:kind, :name, :keywords, :size, :condition, :max_price, :url, "
            ":now)",
            {**w, "now": _now()},
        )
        return int(cur.lastrowid)


def list_watches(include_archived: bool = False) -> list[dict]:
    where = "" if include_archived else " WHERE archived = 0"
    with _connect() as conn:
        return [dict(r) for r in conn.execute(f"SELECT * FROM shoe_watches{where} ORDER BY id")]


def archive_watch(watch_id: int) -> bool:
    with _connect() as conn:
        return conn.execute(
            "UPDATE shoe_watches SET archived = 1 WHERE id = ?", (watch_id,)
        ).rowcount == 1


def observe_listing(watch_id: int, listing: dict) -> bool:
    """Record a sighting; True when it is new or its price changed. Keeps bounded history."""
    now = _now()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, price FROM shoe_listings WHERE watch_id = ? AND listing_key = ?",
            (watch_id, listing["key"]),
        ).fetchone()
        price = listing.get("price")
        if row is None:
            cur = conn.execute(
                "INSERT INTO shoe_listings (watch_id, listing_key, title, price, condition, "
                "source, url, observed_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (watch_id, listing["key"], listing["title"], price, listing.get("condition"),
                 listing["source"], listing["url"], now, now),
            )
            lid, changed = cur.lastrowid, True
        else:
            lid, changed = row["id"], row["price"] != price
            conn.execute(
                "UPDATE shoe_listings SET title = ?, price = ?, prev_price = CASE WHEN ? "
                "THEN ? ELSE prev_price END, observed_at = ?, changed_at = CASE WHEN ? "
                "THEN ? ELSE changed_at END WHERE id = ?",
                (listing["title"], price, changed, row["price"], now, changed, now, lid),
            )
        conn.execute(
            "INSERT INTO listing_snapshots (listing_id, price, observed_at) VALUES (?, ?, ?)",
            (lid, price, now),
        )
        conn.execute(
            "DELETE FROM listing_snapshots WHERE listing_id = ? AND id NOT IN ("
            "SELECT id FROM listing_snapshots WHERE listing_id = ? ORDER BY id DESC LIMIT ?)",
            (lid, lid, MAX_SNAPSHOTS),
        )
    return changed


def list_listings(
    watch_id: Optional[int] = None, changed_since: Optional[str] = None
) -> list[dict]:
    clauses, params = [], []
    if watch_id is not None:
        clauses.append("l.watch_id = ?")
        params.append(watch_id)
    if changed_since:
        clauses.append("l.changed_at >= ?")
        params.append(changed_since)
    clauses.append("w.archived = 0")
    where = " WHERE " + " AND ".join(clauses)
    with _connect() as conn:
        rows = conn.execute(
            "SELECT l.*, w.name AS watch_name, (SELECT COUNT(*) FROM listing_snapshots s "
            "WHERE s.listing_id = l.id) AS sightings FROM shoe_listings l "
            f"JOIN shoe_watches w ON w.id = l.watch_id{where} ORDER BY l.observed_at DESC",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def price_history(listing_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT price, observed_at FROM listing_snapshots WHERE listing_id = ? ORDER BY id",
            (listing_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# --- Connected accounts and own data ----------------------------------------------------


def save_connection(provider: str, token_enc: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO oauth_connections (provider, token_enc, connected_at) VALUES (?, ?, ?) "
            "ON CONFLICT(provider) DO UPDATE SET token_enc = excluded.token_enc, "
            "connected_at = excluded.connected_at",
            (provider, token_enc, _now()),
        )


def get_connection(provider: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM oauth_connections WHERE provider = ?", (provider,)
        ).fetchone()
    return dict(row) if row else None


def delete_connection(provider: str) -> bool:
    with _connect() as conn:
        return conn.execute(
            "DELETE FROM oauth_connections WHERE provider = ?", (provider,)
        ).rowcount == 1


def upsert_own_item(item: dict) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO own_items (provider, kind, external_id, title, price, url, occurred_at, "
            "updated_at) VALUES (:provider, :kind, :external_id, :title, :price, :url, "
            ":occurred_at, :now) ON CONFLICT(provider, kind, external_id) DO UPDATE SET "
            "title = excluded.title, price = excluded.price, url = excluded.url, "
            "occurred_at = excluded.occurred_at, updated_at = excluded.updated_at",
            {**item, "now": _now()},
        )


def list_own_items(kind: Optional[str] = None, limit: int = 200) -> list[dict]:
    where, params = ("WHERE kind = ?", [kind]) if kind else ("", [])
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM own_items {where} ORDER BY occurred_at DESC, id DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def reminded(event_id: str) -> bool:
    with _connect() as conn:
        return conn.execute(
            "SELECT 1 FROM reminders_sent WHERE event_id = ?", (event_id,)
        ).fetchone() is not None


def mark_reminded(event_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO reminders_sent (event_id, sent_at) VALUES (?, ?)",
            (event_id, _now()),
        )


def get_run(local_date: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM digest_runs WHERE local_date = ?", (local_date,)
        ).fetchone()
    return dict(row) if row else None


def claim_run(local_date: str) -> bool:
    """Atomically take the day's send slot; False if already sent or another call holds it.

    A 'failed' or 'skipped' row may be re-claimed (retry), as may a 'sending' row left by a
    crashed call (older than the 10s send timeout by a wide margin); 'sent' never is.
    """
    now = _now()
    stale = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO digest_runs (local_date, status, attempted_at) "
            "VALUES (?, 'new', ?)",
            (local_date, now),
        )
        return conn.execute(
            "UPDATE digest_runs SET status = 'sending', attempted_at = ?, error = NULL "
            "WHERE local_date = ? AND (status IN ('new', 'failed', 'skipped') "
            "OR (status = 'sending' AND attempted_at < ?))",
            (now, local_date, stale),
        ).rowcount == 1


def finish_run(
    local_date: str, status: str, freshness_at: Optional[str] = None, error: Optional[str] = None
) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE digest_runs SET status = ?, sent_at = ?, freshness_at = ?, error = ? "
            "WHERE local_date = ?",
            (status, _now() if status == "sent" else None, freshness_at, error, local_date),
        )


# --- Daily push toggles ----------------------------------------------------------------


def get_push_prefs() -> dict[str, bool]:
    """Only kinds ever toggled have a row; a missing kind is off."""
    with _connect() as conn:
        return {r["kind"]: bool(r["enabled"]) for r in conn.execute("SELECT * FROM push_prefs")}


def set_push_pref(kind: str, enabled: bool) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO push_prefs (kind, enabled) VALUES (?, ?) "
            "ON CONFLICT(kind) DO UPDATE SET enabled = excluded.enabled",
            (kind, int(enabled)),
        )


# --- Philosophy journal ------------------------------------------------------------------


def get_journal(local_date: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM philosophy_journal WHERE local_date = ?", (local_date,)
        ).fetchone()
    return dict(row) if row else None


def upsert_journal(
    local_date: str, entry_id: str, intention: Optional[str], reflection: Optional[str]
) -> dict:
    """A None field keeps what is stored, so saving the reflection never clears the intention."""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO philosophy_journal (local_date, entry_id, intention, reflection, "
            "updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(local_date) DO UPDATE SET "
            "intention = COALESCE(excluded.intention, philosophy_journal.intention), "
            "reflection = COALESCE(excluded.reflection, philosophy_journal.reflection), "
            "updated_at = excluded.updated_at",
            (local_date, entry_id, intention, reflection, _now()),
        )
    return get_journal(local_date)  # type: ignore[return-value]


def list_journal(limit: int = 365) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM philosophy_journal ORDER BY local_date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


# --- NBA daily report (pushed by bet_watch) ----------------------------------------------

NBA_REPORT_RETENTION_DAYS = 30


def upsert_nba_report(local_date: str, payload: dict) -> None:
    """Re-sends of the same slate replace it; reports older than 30 days are dropped."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=NBA_REPORT_RETENTION_DAYS)).date()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO nba_reports (local_date, payload_json, received_at) VALUES (?, ?, ?) "
            "ON CONFLICT(local_date) DO UPDATE SET payload_json = excluded.payload_json, "
            "received_at = excluded.received_at",
            (local_date, json.dumps(payload), _now()),
        )
        conn.execute("DELETE FROM nba_reports WHERE local_date < ?", (cutoff.isoformat(),))


def get_nba_report(local_date: Optional[str] = None) -> Optional[dict]:
    """The report for a date, or the latest one when no date is given."""
    with _connect() as conn:
        if local_date:
            row = conn.execute(
                "SELECT * FROM nba_reports WHERE local_date = ?", (local_date,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM nba_reports ORDER BY local_date DESC LIMIT 1"
            ).fetchone()
    if not row:
        return None
    return {**json.loads(row["payload_json"]), "received_at": row["received_at"]}


# --- Assistant brief snapshot ------------------------------------------------------------


def save_brief(brief: dict) -> None:
    """Keep only the latest brief (one row); the scheduled refresh replaces it hourly."""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO assistant_snapshot (id, payload, built_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, "
            "built_at = excluded.built_at",
            (json.dumps(brief), _now()),
        )


def load_brief() -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT payload FROM assistant_snapshot WHERE id = 1").fetchone()
    return json.loads(row["payload"]) if row else None
