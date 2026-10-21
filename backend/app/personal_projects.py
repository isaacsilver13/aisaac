"""Project status for the assistant brief: "where did I leave off" and "what needs me".

Local facts (branches, commits, uncommitted work, left-off notes) are pushed hourly by
scripts/push_project_status.py into `metrics_store` under source "projects". GitHub facts (open PRs,
latest CI run) come from the existing GitHubMonitor activity, joined on the origin `owner/repo`
slug because local folder names don't match GitHub repo names.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import metrics_store
from .schemas import RepoActivity

STALE_PUSH = timedelta(hours=3)
# Attention thresholds (days since a worktree's last commit). Tune here.
DIRTY_IDLE_DAYS = 3  # uncommitted files this old were probably forgotten
UNMERGED_IDLE_DAYS = 7  # a feature branch idle this long with unmerged commits is parked
MAIN_BRANCHES = ("main", "master")  # `ahead` here means commits not pushed to origin


def _dt(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _idle_days(worktree: dict, now: datetime) -> int:
    last = _dt(worktree.get("last_commit_at"))
    return (now - last).days if last else 0


def attention_reasons(
    project: dict, repo: Optional[RepoActivity], now: datetime
) -> list[str]:
    """Plain-language reasons this project needs Isaac, most urgent first ([] = all quiet).

    `project` is one pushed ProjectStatus dict: `worktrees` (branch, last_commit_at ISO,
    dirty_files, ahead) and `notes` (newest first). `repo` is its GitHub activity, if known.
    """
    reasons = []
    if repo and repo.ci_status == "failure":
        reasons.append("latest CI run failed")
    for pr in (repo.open_pull_requests if repo else []):
        days = (now - pr.opened_at).days
        if days >= 2:
            reasons.append(f"PR #{pr.number} open {days} days")
    # Local work, one aggregated reason per kind so a repo with many worktrees stays one line.
    # ponytail: "idle" = days since the worktree's last commit (no file mtimes are pushed).
    trees = [(w, _idle_days(w, now)) for w in project["worktrees"]]
    dirty = [days for w, days in trees if w["dirty_files"] and days >= DIRTY_IDLE_DAYS]
    if dirty:
        where = f" in {len(dirty)} worktrees" if len(dirty) > 1 else ""
        reasons.append(f"uncommitted work{where}, untouched {max(dirty)} days")
    unpushed = sum(w["ahead"] or 0 for w, _ in trees if w["branch"] in MAIN_BRANCHES)
    if unpushed:
        reasons.append(f"{unpushed} commit{'s' if unpushed > 1 else ''} on main not pushed")
    parked = [
        days for w, days in trees
        if w["branch"] not in (None, *MAIN_BRANCHES) and (w["ahead"] or 0) > 0
        and days >= UNMERGED_IDLE_DAYS
    ]
    if parked:
        n = len(parked)
        reasons.append(
            f"{n} branch{'es' if n > 1 else ''} with unmerged commits, idle {max(parked)} days"
        )
    return reasons


def section(activity: list[RepoActivity], now: Optional[datetime] = None) -> dict:
    """Projects sorted attention-first, then most recently touched."""
    now = now or datetime.now(timezone.utc)
    row = metrics_store.load("projects")
    if row is None:
        return {"state": "not_connected", "reported_at": None, "projects": []}
    by_slug = {f"{r.owner}/{r.repo}".lower(): r for r in activity}
    out = []
    for p in json.loads(row["payload"])["projects"]:
        repo = by_slug.get((p.get("slug") or "").lower())
        touched = [d for d in (_dt(w.get("last_commit_at")) for w in p["worktrees"]) if d]
        last = max(touched).astimezone(timezone.utc).isoformat() if touched else None
        out.append({
            "folder": p["folder"],
            "slug": p.get("slug"),
            "last_activity_at": last,
            "note": p["notes"][0] if p["notes"] else None,
            "other_notes": max(len(p["notes"]) - 1, 0),
            "worktrees": p["worktrees"],
            "ci_status": repo.ci_status if repo else "unknown",
            "open_prs": [pr.model_dump(mode="json") for pr in repo.open_pull_requests]
            if repo else [],
            "reasons": attention_reasons(p, repo, now),
        })
    out.sort(key=lambda x: x["last_activity_at"] or "", reverse=True)
    out.sort(key=lambda x: not x["reasons"])  # stable: attention first, recency within
    reported = row["reported_at"]
    state = "stale" if now - datetime.fromisoformat(reported) > STALE_PUSH else "ok"
    return {"state": state, "reported_at": reported, "projects": out}
