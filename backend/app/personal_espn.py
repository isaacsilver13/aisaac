"""ESPN public scoreboard JSON as the sports provider (approved 2026-10-19, see
docs/personal-feeds-providers.md). Undocumented: shapes are mapped here and nowhere else, and any
failure is caught by `personal_sports.refresh`, which keeps the last good snapshot.

Date ranges (`dates=A-B`) return 400, so scoreboards are fetched one day at a time.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import httpx

BASE = "https://site.api.espn.com/apis/site/v2/sports"
PATHS = {
    "NFL": "football/nfl",
    "NBA": "basketball/nba",
    "MLB": "baseball/mlb",
    "NCAAF": "football/college-football",  # default scoreboard = Top-25 games
    "NCAAB": "basketball/mens-college-basketball",
}
# ESPN team ids for college priority teams, whose unranked games the Top-25 scoreboard omits.
COLLEGE_TEAMS = {"Northwestern Wildcats": "77", "Temple Owls": "218"}
DAYS_AHEAD = 3
STATES = {"pre": "scheduled", "in": "live", "post": "final"}

Getter = Callable[[str, dict], dict]


def _get(path: str, params: dict) -> dict:
    response = httpx.get(f"{BASE}/{path}", params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def _score(team: dict) -> Optional[str]:
    s = team.get("score")
    return s.get("value") if isinstance(s, dict) else s  # schedules nest it, scoreboards don't


def _rank(team: dict) -> Optional[int]:
    r = (team.get("curatedRank") or {}).get("current")
    return r if isinstance(r, int) and 1 <= r <= 25 else None  # 99 = unranked


def to_raw(league: str, event: dict, poll_date: Optional[str]) -> Optional[dict]:
    """One ESPN event -> the raw dict `personal_sports.normalize` expects, or None."""
    comp = event["competitions"][0]
    if comp.get("timeValid") is False:
        return None  # ponytail: TBD kickoffs (fake midnight) skipped until ESPN sets a time
    sides = {t["homeAway"]: t for t in comp["competitors"]}
    if "home" not in sides or "away" not in sides:
        return None
    kind = (comp.get("status") or event.get("status") or {}).get("type", {})
    postponed = kind.get("name") == "STATUS_POSTPONED"
    status = "postponed" if postponed else STATES.get(kind.get("state"))
    played = status in ("live", "final")
    url = next(
        (link["href"] for link in event.get("links", [])
         if "summary" in link.get("rel", []) and link["href"].startswith("https://")),
        None,
    )
    home_rank, away_rank = _rank(sides["home"]), _rank(sides["away"])
    return {
        "league": league,
        "id": f"espn-{event['id']}",
        "home": sides["home"]["team"]["displayName"],
        "away": sides["away"]["team"]["displayName"],
        "start_at": event["date"],
        "status": status or "scheduled",
        "home_score": _score(sides["home"]) if played else None,
        "away_score": _score(sides["away"]) if played else None,
        "home_rank": home_rank,
        "away_rank": away_rank,
        "poll_date": poll_date if (home_rank or away_rank) else None,
        "url": url,
    }


def _poll_date(league: str, get: Getter) -> Optional[str]:
    polls = get(f"{PATHS[league]}/rankings", {}).get("rankings", [])
    ap = next((p for p in polls if p.get("name", "").startswith("AP")), None)
    return (ap or {}).get("date")


def fetch(get: Getter = _get, now: Optional[datetime] = None) -> list[dict]:
    """Scoreboards for today..+DAYS_AHEAD plus college priority-team schedules."""
    now = now or datetime.now(timezone.utc)
    days = [(now + timedelta(days=d)).strftime("%Y%m%d") for d in range(-1, DAYS_AHEAD + 1)]
    calls = [(lg, f"{p}/scoreboard", {"dates": d}) for lg, p in PATHS.items() for d in days]
    calls += [
        (lg, f"{PATHS[lg]}/teams/{tid}/schedule", {"seasontype": "2"})
        for lg in ("NCAAF", "NCAAB") for tid in COLLEGE_TEAMS.values()
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        polls = dict(zip(("NCAAF", "NCAAB"), pool.map(lambda lg: _poll_date(lg, get),
                                                      ("NCAAF", "NCAAB"))))
        pages = list(pool.map(lambda c: (c[0], get(c[1], c[2])), calls))
    events: dict[str, dict] = {}
    for league, page in pages:
        for event in page.get("events", []):
            raw = to_raw(league, event, polls.get(league))
            if raw:
                events[raw["id"]] = raw
    return list(events.values())
