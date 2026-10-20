"""Gym progress from gym_tracker's token-guarded GET /api/v1/assistant/summary.

gym_tracker scales to zero on Fly, so the timeout allows a cold start. Without
GYM_TRACKER_URL/GYM_TRACKER_TOKEN, or on any error, the brief still links to the app.
"""

from __future__ import annotations

import logging
from typing import Callable

import httpx

logger = logging.getLogger("aisaac.personal")

Getter = Callable[[str, str], dict]


def _get(url: str, token: str) -> dict:
    response = httpx.get(
        f"{url.rstrip('/')}/api/v1/assistant/summary",
        headers={"X-Assistant-Token": token}, timeout=30,
    )
    response.raise_for_status()
    return response.json()


def summary(url: str, token: str, get: Getter = _get) -> dict:
    """{"state": ok|not_connected|fetch_failed, "app_url", "data"}; data is gym_tracker's JSON."""
    out = {"app_url": url or None, "data": None}
    if not url or not token:
        return {**out, "state": "not_connected"}
    try:
        return {**out, "state": "ok", "data": get(url, token)}
    except Exception:  # never surface the token or upstream body
        logger.warning("gym summary fetch failed")
        return {**out, "state": "fetch_failed"}
