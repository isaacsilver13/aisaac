"""Toggleable once-a-day ntfy pushes (philosophy, and later books and the NBA report).

One external hourly job calls `run`. Each kind sends at most once per America/Chicago day, at
or after its hour, and only while toggled on in Settings (`push_prefs`, default off). A kind is
marked sent (`reminders_sent`, key `kind:YYYY-MM-DD`) only after ntfy accepts it, so a failed
or not-yet-ready push retries on the next hourly call.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Callable, Optional

from . import learning, personal_store

# kind -> (send hour in America/Chicago, message builder). A builder returns None for
# "not ready yet, try next hour". Other modules add their kinds here.
PUSHES: dict[str, tuple[int, Callable[[date], Optional[str]]]] = {}


def run(now: datetime, send: Callable[[str], bool]) -> dict[str, str]:
    """Per kind: sent | failed | not_due | not_ready | already_sent | disabled."""
    local = now.astimezone(learning.TZ)
    day = local.date()
    prefs = personal_store.get_push_prefs()
    out: dict[str, str] = {}
    for kind, (hour, build) in PUSHES.items():
        key = f"{kind}:{day.isoformat()}"
        if not prefs.get(kind):
            out[kind] = "disabled"
        elif local.hour < hour:
            out[kind] = "not_due"
        elif personal_store.reminded(key):
            out[kind] = "already_sent"
        elif (message := build(day)) is None:
            out[kind] = "not_ready"
        elif send(message):
            personal_store.mark_reminded(key)
            out[kind] = "sent"
        else:
            out[kind] = "failed"
    return out
