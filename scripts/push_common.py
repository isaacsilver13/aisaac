"""Shared config loading and POST helper for the dashboard push scripts.

Configuration comes from env vars or ~/.claude/aisaac_push.json (same keys):
    AISAAC_DASHBOARD_URL      e.g. https://aisaac-dashboard.fly.dev
    AISAAC_INTERNAL_SECRET    the dashboard's INTERNAL_REPORT_SECRET
    SECOND_BRAIN_PATH         vault folder for second_brain_push.py (default ~/second-brain)
    WORKSPACE_REPOS_PATH      repos folder for push_project_status.py
                              (default ~/nba_prediction/repos)
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any

CONFIG_FILE = Path.home() / ".claude" / "aisaac_push.json"
CONFIG_KEYS = (
    "AISAAC_DASHBOARD_URL", "AISAAC_INTERNAL_SECRET", "SECOND_BRAIN_PATH", "WORKSPACE_REPOS_PATH"
)


def load_config() -> dict[str, str]:
    config: dict[str, str] = {}
    try:
        config.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError):
        pass
    for key in CONFIG_KEYS:
        if os.environ.get(key):
            config[key] = os.environ[key]
    return config


def post_json(
    path: str, payload: dict[str, Any], config: dict[str, str], timeout: float = 10
) -> bool:
    """POST JSON to an /internal path. Returns False (never raises) on failure."""
    url, secret = (
        config.get("AISAAC_DASHBOARD_URL"),
        config.get("AISAAC_INTERNAL_SECRET"),
    )
    if not url or not secret:
        return False
    request = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Internal-Secret": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except Exception:
        return False


def post_metrics(
    source: str, payload: dict[str, Any], config: dict[str, str], timeout: float = 10
) -> bool:
    """POST a snapshot to /internal/metrics/{source}. Returns False (never raises) on failure."""
    return post_json(f"/internal/metrics/{source}", payload, config, timeout)
