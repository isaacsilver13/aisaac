import asyncio
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from app import main, metrics_store, personal_projects
from app.schemas import PullRequestSummary, RepoActivity

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import push_project_status as pps  # noqa: E402

NOW = datetime(2026, 10, 19, 14, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    metrics_store.configure(str(tmp_path / "m.db"))
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")


def _git(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


def test_collect_reads_worktrees_dirty_files_and_notes(tmp_path):
    repo = tmp_path / "repos" / "gym_tracker"
    repo.mkdir(parents=True)
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "remote", "add", "origin", "git@github.com:isaacsilver13/gym.git")
    (repo / "a.txt").write_text("a")
    _git(repo, "add", ".")
    _git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first commit")
    _git(repo, "worktree", "add", "-q", "-b", "claude/x", str(tmp_path / "wt"))
    (repo / "b.txt").write_text("dirty")
    (tmp_path / "repos" / "not_a_repo").mkdir()
    notes = tmp_path / "notes" / "gym_tracker"
    notes.mkdir(parents=True)
    (notes / "claude__x.md").write_text("Doing: summary endpoint\nNext: tests")

    [p] = pps.collect(tmp_path / "repos", fetch=False, notes_dir=tmp_path / "notes")
    assert p["slug"] == "isaacsilver13/gym"
    by_branch = {w["branch"]: w for w in p["worktrees"]}
    assert by_branch["main"]["dirty_files"] == 1 and by_branch["claude/x"]["dirty_files"] == 0
    assert by_branch["main"]["last_commit_subject"] == "first commit"
    assert p["notes"][0]["branch"] == "claude/x" and "summary endpoint" in p["notes"][0]["text"]
    assert all("/" not in w["folder"] and "\\" not in w["folder"] for w in p["worktrees"])


def _push(payload):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/internal/metrics/projects", json=payload, headers={"X-Internal-Secret": "secret"}
            )

    return asyncio.run(run())


def _project(folder, slug, last, note=None):
    return {
        "folder": folder, "slug": slug,
        "worktrees": [{"folder": folder, "branch": "main", "last_commit_at": last,
                       "last_commit_subject": "x", "dirty_files": 0, "ahead": 0}],
        "notes": [{"branch": "main", "updated_at": last, "text": note}] if note else [],
    }


def _activity(repo, ci="success", pr_age_days=None):
    prs = [PullRequestSummary(number=12, title="t", url="https://github.com/x/pull/12",
                              opened_at=NOW - timedelta(days=pr_age_days))] if pr_age_days else []
    return RepoActivity(repo_id=repo, name=repo, category="x", owner="isaacsilver13", repo=repo,
                        ci_status=ci, open_pull_requests=prs, checked_at=NOW)


def test_section_joins_on_slug_and_sorts_attention_first():
    payload = {"projects": [
        _project("gym_tracker", "isaacsilver13/gym", "2026-10-19T09:00:00-05:00", "Doing: x"),
        _project("aisaac_dashboard", "isaacsilver13/aisaac", "2026-10-10T09:00:00-05:00"),
        _project("chicago_big_data", None, "2026-10-18T09:00:00-05:00"),
    ]}
    assert _push(payload).status_code == 204
    out = personal_projects.section(
        [_activity("gym"), _activity("aisaac", ci="failure", pr_age_days=6)], NOW
    )
    assert out["state"] == "ok"
    folders = [p["folder"] for p in out["projects"]]
    assert folders == ["aisaac_dashboard", "gym_tracker", "chicago_big_data"]
    assert out["projects"][0]["reasons"] == ["latest CI run failed", "PR #12 open 6 days"]
    assert out["projects"][1]["note"]["text"] == "Doing: x"
    assert out["projects"][2]["ci_status"] == "unknown"


def test_section_states_without_or_with_old_push():
    assert personal_projects.section([], NOW)["state"] == "not_connected"
    assert _push({"projects": []}).status_code == 204
    assert personal_projects.section([], NOW + timedelta(days=30))["state"] == "stale"


def test_invalid_payload_is_rejected_and_logged():
    assert _push({"projects": [{"folder": "x" * 500}]}).status_code == 422
    assert metrics_store.last_failure("projects")["error"] == "invalid_payload"
