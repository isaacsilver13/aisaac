"""Push notifications for CI/PR/issue events, via ntfy.sh.

Same fallback pattern as alerts.py: if NTFY_TOPIC isn't set, notifications
are logged instead of sent -- local/dev never needs a real topic.
"""

from __future__ import annotations

import logging

import httpx

from .config import Settings

logger = logging.getLogger("aisaac.notify")


def send_coms_notification(settings: Settings, message: str) -> bool:
    """True only when ntfy accepted the message, so callers can retry a failed push."""
    if not settings.ntfy_topic:
        logger.warning("COMS (not sent, no ntfy topic configured): %s", message)
        return False

    try:
        response = httpx.post(
            f"https://ntfy.sh/{settings.ntfy_topic}",
            content=message.encode("utf-8"),
            timeout=10.0,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        logger.exception("Failed to send Coms notification via ntfy.sh")
        return False
    return True
