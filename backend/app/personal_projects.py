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


def _dt(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


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
    # TODO(Isaac): local-work rules. Each worktree has `dirty_files`, `ahead` (commits not on
    # main) and `last_commit_at`. Decide what counts as "needs me", e.g. uncommitted work left
    # untouched for N days, or a branch with commits never merged. Thresholds are your call.
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
