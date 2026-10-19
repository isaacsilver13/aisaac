from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

GITHUB_API_BASE = "https://api.github.com"


def _headers(token: str) -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def get_latest_run_status(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float,
    workflow: str = "ci.yml",
) -> Optional[tuple[str, Optional[str]]]:
    """Returns (status, conclusion) for a named workflow, or None on failure."""
    try:
        response = await client.get(
            f"{GITHUB_API_BASE}/repos/{owner}/{repo}/actions/workflows/{workflow}/runs",
            params={"per_page": 1},
            headers=_headers(token),
            timeout=timeout,
        )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    runs = payload.get("workflow_runs") or []
    if not runs:
        return None
    latest = runs[0]
    return latest.get("status"), latest.get("conclusion")


async def get_open_issue_count(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float
) -> Optional[int]:
    try:
        response = await client.get(
            f"{GITHUB_API_BASE}/repos/{owner}/{repo}/issues",
            params={"state": "open", "per_page": 100},
            headers=_headers(token),
            timeout=timeout,
        )
        response.raise_for_status()
        items: list[dict[str, Any]] = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    return sum(1 for item in items if "pull_request" not in item)


async def _get_json(
    client: httpx.AsyncClient, token: str, url: str, timeout: float, params: dict[str, Any]
) -> Any:
    try:
        response = await client.get(url, params=params, headers=_headers(token), timeout=timeout)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        return None


async def list_owner_repos(
    client: httpx.AsyncClient, token: str, owner: str, timeout: float
) -> Optional[list[dict[str, Any]]]:
    """Every repo `owner` owns. A token sees private repos via /user/repos; without one
    only public repos are listed."""
    # ponytail: one page of 100 repos; paginate if the account outgrows it.
    if token:
        url, params = f"{GITHUB_API_BASE}/user/repos", {"affiliation": "owner", "per_page": 100}
    else:
        url, params = f"{GITHUB_API_BASE}/users/{owner}/repos", {"type": "owner", "per_page": 100}
    items = await _get_json(client, token, url, timeout, params)
    if not isinstance(items, list):
        return None
    return [item for item in items if item["owner"]["login"].lower() == owner.lower()]


async def get_pull_requests(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float
) -> Optional[list[dict[str, Any]]]:
    """The 100 most recently opened PRs in any state (open ones and merge history)."""
    # ponytail: one page; an open PR older than the 100 newest is missed.
    items = await _get_json(
        client,
        token,
        f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls",
        timeout,
        {"state": "all", "sort": "created", "direction": "desc", "per_page": 100},
    )
    return items if isinstance(items, list) else None


def _parse_time(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def summarize_open_pull_requests(
    items: list[dict[str, Any]], stale_days: int
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    stale_after = timedelta(days=stale_days)
    summaries = []
    for item in items:
        if item.get("state") != "open":
            continue
        opened_at = _parse_time(item["created_at"])
        summaries.append(
            {
                "number": item["number"],
                "title": item["title"],
                "url": item["html_url"],
                "opened_at": opened_at,
                "stale": now - opened_at > stale_after,
            }
        )
    return summaries


def pull_request_history(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Dates only: when each PR was opened and, if merged, when."""
    return [
        {
            "opened_at": _parse_time(item["created_at"]),
            "merged_at": _parse_time(item["merged_at"]) if item.get("merged_at") else None,
        }
        for item in items
    ]


async def get_weekly_commits(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float
) -> Optional[list[dict[str, Any]]]:
    """52 weeks of default-branch commits: {"week": unix seconds (Sunday), "days": [Sun..Sat]}.

    GitHub answers 202 while it computes these stats; retry once, then give up until the
    next refresh rather than block the page."""
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/stats/commit_activity"
    for attempt in range(2):
        try:
            response = await client.get(url, headers=_headers(token), timeout=timeout)
            response.raise_for_status()
            if response.status_code == 202:
                if attempt == 0:
                    await asyncio.sleep(2)
                continue
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(payload, list):
            return None
        return [{"week": item["week"], "days": item["days"]} for item in payload]
    return None


async def get_languages(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float
) -> Optional[dict[str, int]]:
    """Bytes of code per language."""
    payload = await _get_json(
        client, token, f"{GITHUB_API_BASE}/repos/{owner}/{repo}/languages", timeout, {}
    )
    return payload if isinstance(payload, dict) else None


async def get_commit_activity(
    client: httpx.AsyncClient, token: str, owner: str, repo: str, timeout: float
) -> Optional[tuple[int, Optional[datetime]]]:
    """Returns (commit count in the last 7 days, timestamp of the latest commit)."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        response = await client.get(
            f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits",
            params={"since": since, "per_page": 100},
            headers=_headers(token),
            timeout=timeout,
        )
        response.raise_for_status()
        items: list[dict[str, Any]] = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    last_commit_at: Optional[datetime] = None
    if items:
        latest_raw = items[0]["commit"]["committer"]["date"]
        last_commit_at = datetime.fromisoformat(latest_raw.replace("Z", "+00:00"))
    return len(items), last_commit_at
