"""Push local project status (branches, last commits, uncommitted work, left-off notes).

For every git repo under WORKSPACE_REPOS_PATH and each of its worktrees: branch, last commit,
dirty file count and commits not on origin/<default>. Left-off notes come from
~/.claude/left-off/<repo folder>/<branch with / as __>.md (written by Claude at session wrap-up).
Only folder names leave this machine, never full paths or file contents other than the notes.

    python scripts/push_project_status.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push_common  # noqa: E402

NOTES_DIR = Path.home() / ".claude" / "left-off"
SLUG = re.compile(r"[:/]([^/:]+/[^/]+?)(?:\.git)?/?$")
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}


def git(cwd: Path, *args: str, timeout: float = 20) -> Optional[str]:
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), *args], capture_output=True, text=True, encoding="utf-8",
            timeout=timeout, env=GIT_ENV,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def worktrees(repo: Path) -> list[tuple[Path, Optional[str]]]:
    """(path, branch) per existing worktree; branch is None when detached."""
    out, path = [], None
    for line in (git(repo, "worktree", "list", "--porcelain") or "").splitlines():
        if line.startswith("worktree "):
            path = Path(line[9:])
        elif line.startswith("branch ") and path:
            out.append((path, line[7:].removeprefix("refs/heads/")))
            path = None
        elif line == "detached" and path:
            out.append((path, None))
            path = None
    return [(p, b) for p, b in out if p.exists()]


def worktree_status(path: Path, branch: Optional[str], default: Optional[str]) -> dict:
    stamp, _, subject = (git(path, "log", "-1", "--format=%cI%x00%s") or "").partition("\x00")
    ahead = git(path, "rev-list", "--count", f"{default}..HEAD") if default else None
    return {
        "folder": path.name,
        "branch": branch,
        "last_commit_at": stamp or None,
        "last_commit_subject": subject[:200],
        "dirty_files": len((git(path, "status", "--porcelain") or "").splitlines()),
        "ahead": int(ahead) if ahead and ahead.isdigit() else None,
    }


def notes_for(folder: str, notes_dir: Path = NOTES_DIR) -> list[dict]:
    files = sorted((notes_dir / folder).glob("*.md"), key=lambda f: f.stat().st_mtime, reverse=True)
    return [
        {
            "branch": f.stem.replace("__", "/"),
            "updated_at": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(),
            "text": f.read_text(encoding="utf-8-sig").strip()[:1000],
        }
        for f in files[:5]
    ]


def project(repo: Path, fetch: bool = True, notes_dir: Path = NOTES_DIR) -> dict:
    if fetch:
        git(repo, "fetch", "--quiet", "origin")  # best effort; stale refs only skew `ahead`
    match = SLUG.search(git(repo, "remote", "get-url", "origin") or "")
    fallbacks = ("origin/main", "origin/master")
    default = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD") or next(
        (b for b in fallbacks if git(repo, "rev-parse", "--verify", "-q", b)), None
    )
    return {
        "folder": repo.name,
        "slug": match.group(1) if match else None,
        "worktrees": [worktree_status(p, b, default) for p, b in worktrees(repo)][:30],
        "notes": notes_for(repo.name, notes_dir),
    }


def collect(root: Path, fetch: bool = True, notes_dir: Path = NOTES_DIR) -> list[dict]:
    return [
        project(d, fetch, notes_dir)
        for d in sorted(root.iterdir())
        if (d / ".git").is_dir() and not d.name.endswith("-git-legacy-backup")
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-fetch", action="store_true", help="skip `git fetch` (offline)")
    args = parser.parse_args()
    config = push_common.load_config()
    root = Path(
        os.environ.get("WORKSPACE_REPOS_PATH")
        or config.get("WORKSPACE_REPOS_PATH")
        or Path.home() / "nba_prediction" / "repos"
    )
    payload = {"projects": collect(root, fetch=not args.no_fetch)}
    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0
    ok = push_common.post_metrics("projects", payload, config, timeout=30)
    print("pushed" if ok else "push failed (check AISAAC_DASHBOARD_URL / AISAAC_INTERNAL_SECRET)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
