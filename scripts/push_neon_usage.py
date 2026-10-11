"""Push Neon compute hours per project (current calendar month) to the dashboard.

Neon's API reports usage, not dollars, so this pushes compute hours plus the account's
plan. On the Free plan the cost is exactly $0 and the dashboard shows each project's
hours against the free allowance (FREE_HOURS_PER_PROJECT). Needs a Neon API key with
read access: NEON_API_KEY (and NEON_ORG_ID for org projects).

Tries the v2 consumption endpoint first (Launch plans and above), then the legacy
one (Scale and above), then the project list's `cpu_used_sec` counters (any plan,
current period only). Compute hours are
compute-unit seconds / 3600 (v2) or `compute_time_seconds` / 3600 (legacy).

    python scripts/push_neon_usage.py [--month 2026-09] [--plan free] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push_common  # noqa: E402

API = "https://console.neon.tech/api/v2"
# https://neon.com/pricing: Free includes 100 CU-hours per project per month.
FREE_HOURS_PER_PROJECT = 100.0


def _get(path: str, params: dict[str, Any], key: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(params, doseq=True)
    request = urllib.request.Request(
        f"{API}{path}?{query}",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")[:500]
        print(f"Neon {path} -> HTTP {exc.code}: {body}", file=sys.stderr)
        raise


def _item_seconds(item: dict[str, Any]) -> float:
    """Compute seconds from one consumption row, tolerating v2 and legacy shapes."""
    for field in ("compute_unit_seconds", "compute_time_seconds"):
        if isinstance(item.get(field), (int, float)):
            return float(item[field])
    for metric in item.get("metrics") or []:
        if metric.get("metric_name") == "compute_unit_seconds":
            return float(metric.get("value") or 0)
    return 0.0


def project_seconds(response: dict[str, Any]) -> dict[str, float]:
    """{project_id: total compute seconds} summed over all periods and timeframes."""
    totals: dict[str, float] = {}
    for project in response.get("projects", []):
        seconds = sum(
            _item_seconds(item)
            for period in project.get("periods", [])
            for item in period.get("consumption", [])
        )
        totals[project["project_id"]] = totals.get(project["project_id"], 0.0) + seconds
    return totals


def build_payload(
    seconds_by_project: dict[str, float],
    names: dict[str, str],
    period: str,
    plan: Optional[str] = None,
) -> dict[str, Any]:
    by_app = {
        names.get(pid, pid): round(seconds / 3600, 3) for pid, seconds in seconds_by_project.items()
    }
    payload: dict[str, Any] = {
        "period": period,
        "total_compute_hours": round(sum(by_app.values()), 3),
        "by_app": dict(sorted(by_app.items())),
        "plan": plan,
    }
    if plan and plan.startswith("free"):
        payload["free_hours_per_project"] = FREE_HOURS_PER_PROJECT
    return payload


def fetch_plan(key: str, org_id: Optional[str]) -> Optional[str]:
    """Billing plan id (e.g. "free_v3", "launch"), or None if the key can't read it."""
    try:
        body = _get(f"/organizations/{org_id}" if org_id else "/users/me", {}, key)
    except urllib.error.HTTPError:
        return None
    return body.get("plan")


def fetch_projects(key: str, org_id: Optional[str]) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"limit": 400}
    if org_id:
        params["org_id"] = org_id
    return _get("/projects", params, key).get("projects", [])


def counter_seconds(projects: list[dict[str, Any]]) -> dict[str, float]:
    """Current-period compute seconds from the project list (works on every plan).

    `cpu_used_sec` is compute-unit seconds for the current billing period; it resets
    at the start of each period, so past months cannot be recovered this way.
    """
    return {p["id"]: float(p.get("cpu_used_sec") or 0) for p in projects}


def fetch_seconds(
    key: str, org_id: Optional[str], start: datetime, end: datetime
) -> dict[str, float]:
    base: dict[str, Any] = {
        "from": start.isoformat().replace("+00:00", "Z"),
        "to": end.isoformat().replace("+00:00", "Z"),
        "granularity": "daily",
        "limit": 100,
    }
    if org_id:
        base["org_id"] = org_id
    try:
        v2_params = {**base, "metrics": "compute_unit_seconds"}
        return project_seconds(_get("/consumption_history/v2/projects", v2_params, key))
    except urllib.error.HTTPError as exc:
        if exc.code not in (400, 403, 404):
            raise
    return project_seconds(_get("/consumption_history/projects", base, key))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--month", help="YYYY-MM to report (default: current month)")
    parser.add_argument("--plan", help="Neon plan id if the key can't read it (e.g. free)")
    parser.add_argument("--dry-run", action="store_true", help="print the payload, don't push")
    args = parser.parse_args()

    key = os.environ.get("NEON_API_KEY")
    if not key:
        print("NEON_API_KEY is not set.", file=sys.stderr)
        return 2
    org_id = os.environ.get("NEON_ORG_ID")
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    if args.month:
        try:
            start = datetime.strptime(args.month, "%Y-%m").replace(tzinfo=timezone.utc)
        except ValueError:
            parser.error("--month must look like 2026-09")
    else:
        start = now.replace(day=1, hour=0)
    next_month = (start + timedelta(days=32)).replace(day=1)
    end = min(now, next_month)
    if end <= start:  # first hour of the month: the API rejects an empty range
        end = start + timedelta(hours=1)

    projects = fetch_projects(key, org_id)
    try:
        seconds = fetch_seconds(key, org_id, start, end)
    except urllib.error.HTTPError as exc:
        if exc.code not in (400, 403):
            raise
        if start.strftime("%Y-%m") != now.strftime("%Y-%m"):
            print("No consumption history for that month; past months cannot be rebuilt.",
                  file=sys.stderr)
            return 1
        print("Consumption API unavailable; using per-project counters.", file=sys.stderr)
        seconds = counter_seconds(projects)
    names = {p["id"]: p["name"] for p in projects}
    plan = args.plan or fetch_plan(key, org_id)
    payload = build_payload(seconds, names, start.strftime("%Y-%m"), plan)
    print(json.dumps(payload, indent=2))
    if args.dry_run:
        return 0
    if not push_common.post_metrics("neon", payload, push_common.load_config()):
        print("Push failed (check AISAAC_DASHBOARD_URL / AISAAC_INTERNAL_SECRET).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
