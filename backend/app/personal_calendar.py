"""Today's Google Calendar events, read-only, from the calendar's secret iCal address.

Google Calendar → Settings → (calendar) → Integrate calendar → "Secret address in iCal format",
stored as GOOGLE_CALENDAR_ICS_URL. No OAuth and no write access. Recurring events are expanded by
`recurring_ical_events` (RRULE/EXDATE/overrides are not worth hand-rolling).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

logger = logging.getLogger("aisaac.personal")
TZ = ZoneInfo("America/Chicago")

Fetcher = Callable[[str], bytes]


def _fetch(url: str) -> bytes:
    response = httpx.get(url, timeout=10, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _local(value: date | datetime) -> date | datetime:
    if not isinstance(value, datetime):
        return value  # all-day
    return (value if value.tzinfo else value.replace(tzinfo=TZ)).astimezone(TZ)  # floating = local


def today(url: str, now: datetime, fetch: Fetcher = _fetch) -> dict:
    """{"state": ok|not_connected|fetch_failed, "events": [...]} for the Chicago calendar day."""
    if not url:
        return {"state": "not_connected", "events": []}
    try:
        cal = icalendar.Calendar.from_ical(fetch(url))
        day = now.astimezone(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        found = recurring_ical_events.of(cal).between(day, day + timedelta(days=1))
    except Exception:  # never surface the secret URL or upstream body
        logger.warning("calendar fetch failed", exc_info=False)
        return {"state": "fetch_failed", "events": []}
    events = []
    for ev in found:
        start = _local(ev["DTSTART"].dt)
        end: Optional[date | datetime] = _local(ev["DTEND"].dt) if ev.get("DTEND") else None
        events.append({
            "title": str(ev.get("SUMMARY") or "(no title)"),
            "all_day": not isinstance(start, datetime),
            "start": start.isoformat(),
            "end": end.isoformat() if end else None,
            "location": str(ev.get("LOCATION") or "") or None,
        })
    events.sort(key=lambda e: (not e["all_day"], e["start"]))
    return {"state": "ok", "events": events}
