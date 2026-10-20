"""The assistant brief: one read-only snapshot of today across calendar, projects, games and gym.

Served at GET /api/v1/personal/assistant (page + Claude skill) and folded into the 08:00 digest,
whose ntfy push uses `push_line`. Every section carries its own state, so one missing source
never hides the others.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from . import personal_calendar, personal_gym, personal_projects, personal_sports, personal_store
from .personal_sports import TZ
from .schemas import RepoActivity

SLATE_LEAGUES = ("NFL", "NBA")


def _day_window(now: datetime, days: int = 1) -> tuple[str, str]:
    """The Chicago calendar day(s) as UTC ISO strings, comparable with stored `start_at`."""
    start = now.astimezone(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=days)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()


def games(now: datetime) -> dict:
    """Priority-team games today/tomorrow, then today's Top-25 and NFL/NBA slates (deduped)."""
    lo, hi = _day_window(now)
    tomorrow = _day_window(now, days=2)[1]
    priority = [
        g for g in personal_sports.priority_events(now, days=2)
        if g["status"] in ("scheduled", "live") and g["start_at"] < tomorrow
    ]
    seen = {g["id"] for g in priority}
    top_25 = []
    if personal_sports.rankings_status(now)["current"]:
        top_25 = [g for g in personal_store.list_events(top_25_only=True, date_from=lo, date_to=hi)
                  if g["id"] not in seen]
        seen |= {g["id"] for g in top_25}
    slate = {
        lg: [g for g in personal_store.list_events(league=lg, date_from=lo, date_to=hi)
             if g["id"] not in seen]
        for lg in SLATE_LEAGUES
    }
    return {
        "configured": personal_sports.PROVIDER is not None,
        "priority": priority, "top_25": top_25, "slate": slate,
    }


async def build(
    now: datetime,
    *,
    activity: Callable[[], Awaitable[list[RepoActivity]]],
    calendar_url: str,
    gym_url: str,
    gym_token: str,
) -> dict:
    calendar, gym, repos = await asyncio.gather(
        asyncio.to_thread(personal_calendar.today, calendar_url, now),
        asyncio.to_thread(personal_gym.summary, gym_url, gym_token),
        activity(),
    )
    return {
        "generated_at": now.isoformat(),
        "calendar": calendar,
        "projects": personal_projects.section(repos, now),
        "games": games(now),
        "gym": gym,
    }


def push_line(brief: dict, page_url: str) -> str:
    """The morning ntfy text: counts and the first priority game, then a link to the page."""
    parts = []
    if brief["calendar"]["state"] == "ok":
        n = len(brief["calendar"]["events"])
        parts.append(f"{n} event{'' if n == 1 else 's'}")
    need = sum(1 for p in brief["projects"]["projects"] if p["reasons"])
    if need:
        parts.append(f"{need} project{'' if need == 1 else 's'} need you")
    if brief["games"]["priority"]:
        g = brief["games"]["priority"][0]
        when = datetime.fromisoformat(g["start_at"]).astimezone(TZ)
        parts.append(f"{g['away']} @ {g['home']} {when:%a} {when.strftime('%I:%M %p').lstrip('0')}")
    day = ((brief["gym"].get("data") or {}).get("next_gym_day") or {}).get("name")
    if day:
        parts.append(f"Gym: {day}")
    return " · ".join(parts or ["Nothing scheduled"]) + f"\n{page_url}"
