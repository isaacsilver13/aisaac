"""Estimate Fly.io month-to-date cost per app and push it to the dashboard.

Fly has no billing API, so per-app dollars are ESTIMATES priced from measured usage:

  * compute: each machine's run time from Fly's managed Prometheus (`fly_instance_up`,
    one sample per 15s while running) x its size at published shared-CPU rates
  * volumes: provisioned GB x $0.15/GB-month, prorated
  * dedicated IPv4: $2/month, prorated (shared IPv4 and IPv6 are free)

Not counted: stopped machines' root filesystem ($0.15/GB-month; Fly exposes no size),
egress (tiny for these apps) and anything outside apps (support plans, tax).

Prometheus keeps only recent days, so finished days are cached in STATE_FILE and a daily
run keeps the whole month. Optionally pass the month-to-date total from Fly's billing page
with --invoice-total (remembered for the month); it is shown next to the estimates, never
spread across apps.

Token: FLY_API_TOKEN if set (a read-only org token is enough), else `fly auth token`.

    python scripts/push_fly_costs.py [--invoice-total 10.30] [--org personal] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push_common  # noqa: E402

# https://fly.io/docs/about/pricing (shared CPU, iad): 1 shared CPU ~ $1.30/mo,
# RAM ~ $2.60/GB/mo (matches the published 256MB/512MB/1GB presets).
CPU_MONTH = 1.30
RAM_GB_MONTH = 2.60
VOLUME_GB_MONTH = 0.15
DEDICATED_IPV4_MONTH = 2.00
MONTH_SECONDS = 30 * 86400
SCRAPE_SECONDS = 15  # fly_instance_up sample interval
DEFAULT_GUEST = {"cpu_kind": "shared", "cpus": 1, "memory_mb": 256}
PROMETHEUS = "https://api.fly.io/prometheus/{org}/api/v1/query_range"
STATE_FILE = Path.home() / ".claude" / "aisaac_fly_invoice.json"


def machine_monthly_price(guest: dict[str, Any]) -> Optional[float]:
    """Monthly price of an always-on shared-CPU machine, or None if not priceable."""
    if guest.get("cpu_kind", "shared") != "shared":
        return None
    return guest.get("cpus", 1) * CPU_MONTH + guest.get("memory_mb", 256) / 1024 * RAM_GB_MONTH


def daily_uptime(response: dict[str, Any]) -> dict[str, dict[str, dict[str, float]]]:
    """{day: {app: {machine: seconds up}}} from a 1-day-step count_over_time query_range.

    The value at timestamp t counts samples in (t - 1d, t], i.e. the day before t.
    """
    days: dict[str, dict[str, dict[str, float]]] = {}
    for series in response.get("data", {}).get("result", []):
        app, machine = series["metric"].get("app"), series["metric"].get("instance")
        if not app or not machine:
            continue
        for ts, count in series.get("values", []):
            day = (datetime.fromtimestamp(float(ts), timezone.utc) - timedelta(days=1)).date()
            seconds = float(count) * SCRAPE_SECONDS
            days.setdefault(day.isoformat(), {}).setdefault(app, {})[machine] = seconds
    return days


def merge_days(cached: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any]:
    """Per day/app/machine max, so a day that has aged out of Prometheus keeps its cached
    value and a day only partly retained never shrinks what was already seen."""
    merged = json.loads(json.dumps(cached))
    for day, apps in fresh.items():
        for app, machines in apps.items():
            slot = merged.setdefault(day, {}).setdefault(app, {})
            for machine, seconds in machines.items():
                slot[machine] = max(slot.get(machine, 0.0), seconds)
    return merged


def app_costs(
    uptime: dict[str, float],
    machines: list[dict[str, Any]],
    volumes: list[dict[str, Any]],
    ips: list[dict[str, Any]],
    elapsed_fraction: float,
) -> float:
    """Month-to-date dollars for one app. `uptime` is {machine id: seconds this month}."""
    guests = {m["id"]: m.get("config", {}).get("guest", {}) for m in machines if "id" in m}
    # Destroyed machines keep their uptime but not their config: price them like the app's
    # first current machine.
    fallback = next(iter(guests.values()), DEFAULT_GUEST)
    cost = 0.0
    for machine, seconds in uptime.items():
        price = machine_monthly_price(guests.get(machine, fallback))
        if price is not None:
            cost += price * seconds / MONTH_SECONDS
    cost += sum(v.get("size_gb", 0) * VOLUME_GB_MONTH * elapsed_fraction for v in volumes)
    cost += sum(DEDICATED_IPV4_MONTH * elapsed_fraction for ip in ips if ip.get("Type") == "v4")
    return cost


def build_payload(
    costs: dict[str, float],
    hours: dict[str, float],
    period: str,
    invoice_total: Optional[float],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "period": period,
        "total_usd": round(sum(costs.values()), 2),
        "by_app": {app: round(cost, 2) for app, cost in sorted(costs.items())},
        "machine_hours": {app: round(h, 2) for app, h in sorted(hours.items())},
        "estimated": True,
    }
    if invoice_total is not None:
        payload["invoice_total_usd"] = round(invoice_total, 2)
    return payload


def _fly_json(*args: str) -> Any:
    result = subprocess.run(["fly", *args, "--json"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"fly {' '.join(args)} failed: {result.stderr.strip()[:200]}")
    return json.loads(result.stdout or "null") or []


def _fly_token() -> str:
    token = os.environ.get("FLY_API_TOKEN", "").strip()
    if not token:
        result = subprocess.run(
            ["fly", "auth", "token"], capture_output=True, text=True, timeout=30
        )
        token = result.stdout.strip()
    if not token:
        raise RuntimeError("No Fly token: set FLY_API_TOKEN or run `fly auth login`.")
    return token if token.startswith("FlyV1 ") else f"FlyV1 {token}"


def fetch_uptime(org: str, start: datetime, now: datetime) -> dict[str, Any]:
    query = {
        "query": "sum by (app, instance) (count_over_time(fly_instance_up[1d]))",
        "start": int((start + timedelta(days=1)).timestamp()),
        # One step past now so today's partial day is included.
        "end": int((now.replace(hour=0, minute=0, second=0) + timedelta(days=1)).timestamp()),
        "step": "1d",
    }
    request = urllib.request.Request(
        PROMETHEUS.format(org=urllib.parse.quote(org)),
        data=urllib.parse.urlencode(query).encode(),
        headers={"Authorization": _fly_token()},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return daily_uptime(json.load(response))


def _load_state(period: str) -> dict[str, Any]:
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return state if state.get("period") == period else {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--invoice-total", type=float, help="month-to-date total from the Fly billing page"
    )
    parser.add_argument("--org", default="personal", help="Fly org slug (default: personal)")
    parser.add_argument("--dry-run", action="store_true", help="print the payload, don't push")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period = now.strftime("%Y-%m")
    state = _load_state(period)
    days = merge_days(state.get("days", {}), fetch_uptime(args.org, start, now))
    invoice = args.invoice_total if args.invoice_total is not None else state.get("total")
    STATE_FILE.write_text(json.dumps({"period": period, "total": invoice, "days": days}))

    uptime: dict[str, dict[str, float]] = {}
    for apps in days.values():
        for app, machines in apps.items():
            for machine, seconds in machines.items():
                uptime.setdefault(app, {})
                uptime[app][machine] = uptime[app].get(machine, 0.0) + seconds

    elapsed = (now - start).total_seconds() / MONTH_SECONDS
    costs, hours = {}, {}
    for app in _fly_json("apps", "list"):
        name = app["Name"]
        app_uptime = uptime.get(name, {})
        costs[name] = app_costs(
            app_uptime,
            _fly_json("machine", "list", "-a", name),
            _fly_json("volumes", "list", "-a", name),
            _fly_json("ips", "list", "-a", name),
            elapsed,
        )
        hours[name] = sum(app_uptime.values()) / 3600

    payload = build_payload(costs, hours, period, invoice)
    print(json.dumps(payload, indent=2))
    if args.dry_run:
        return 0
    if not push_common.post_metrics("fly", payload, push_common.load_config()):
        print("Push failed (check AISAAC_DASHBOARD_URL / AISAAC_INTERNAL_SECRET).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
