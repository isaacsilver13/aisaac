import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from app.github_monitor import GitHubMonitor, _ci_status
from app.schemas import RepoDefinition


def _repo(**overrides) -> RepoDefinition:
    defaults = dict(id="fixture", name="Fixture", category="Test", owner="acme", repo="widgets")
    defaults.update(overrides)
    return RepoDefinition(**defaults)


def test_check_repo_reports_success_from_latest_run() -> None:
    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/runs"):
            run = {"status": "completed", "conclusion": "success"}
            return httpx.Response(200, json={"workflow_runs": [run]})
        if request.url.path.endswith("/issues"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/pulls"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[])
        return httpx.Response(404)

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.ci_status == "success"
    assert result.open_issue_count == 0
    assert result.open_pr_count == 0
    assert result.commits_last_7d == 0


def test_check_repo_reports_failure_conclusion() -> None:
    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/runs"):
            run = {"status": "completed", "conclusion": "failure"}
            return httpx.Response(200, json={"workflow_runs": [run]})
        return httpx.Response(200, json=[])

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.ci_status == "failure"


def test_check_repo_filters_pull_requests_out_of_issue_count() -> None:
    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/runs"):
            return httpx.Response(200, json={"workflow_runs": []})
        if request.url.path.endswith("/issues"):
            return httpx.Response(
                200,
                json=[{"pull_request": {}}, {"title": "a real issue"}],
            )
        if request.url.path.endswith("/pulls"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[])
        return httpx.Response(404)

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.open_issue_count == 1


def test_check_repo_flags_stale_pull_requests() -> None:
    repo = _repo(stale_days=3)
    stale_dt = datetime.now(timezone.utc) - timedelta(days=10)
    stale_opened_at = stale_dt.isoformat().replace("+00:00", "Z")
    fresh_opened_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/runs"):
            return httpx.Response(200, json={"workflow_runs": []})
        if request.url.path.endswith("/issues"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/pulls"):
            stale_pr = {
                "number": 1,
                "state": "open",
                "title": "stale one",
                "html_url": "https://x/1",
                "created_at": stale_opened_at,
            }
            fresh_pr = {
                "number": 2,
                "state": "open",
                "title": "fresh one",
                "html_url": "https://x/2",
                "created_at": fresh_opened_at,
            }
            return httpx.Response(200, json=[stale_pr, fresh_pr])
        if request.url.path.endswith("/commits"):
            return httpx.Response(200, json=[])
        return httpx.Response(404)

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.open_pr_count == 2
    by_number = {pr.number: pr for pr in result.open_pull_requests}
    assert by_number[1].stale is True
    assert by_number[2].stale is False


def test_check_repo_soft_fails_on_http_error() -> None:
    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.ci_status == "unknown"
    assert result.open_issue_count is None
    assert result.open_pr_count is None
    assert result.commits_last_7d is None


def test_activity_uses_ttl_cache(monkeypatch) -> None:
    import app.github_monitor as gm

    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/repos":
            return httpx.Response(503)  # listing unavailable: fall back to curated repos
        is_actions = "actions" in str(request.url)
        return httpx.Response(200, json={"workflow_runs": []} if is_actions else [])

    original_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original_client(*args, **kwargs)

    monkeypatch.setattr(gm.httpx, "AsyncClient", patched_client)

    monitor = GitHubMonitor(token="fixture-token", cache_ttl_seconds=30)

    async def run() -> tuple[list[object], list[object]]:
        first = await monitor.activity((repo,))
        second = await monitor.activity((repo,))
        return first, second

    first, second = asyncio.run(run())

    assert first[0].cached is False
    assert second[0].cached is True


def test_check_repo_flags_missing_token() -> None:
    repo = _repo()

    async def handler(request: httpx.Request) -> httpx.Response:
        is_actions = "actions" in str(request.url)
        return httpx.Response(200, json={"workflow_runs": []} if is_actions else [])

    async def run() -> object:
        monitor = GitHubMonitor(token="")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.detail == "No GitHub token configured; live GitHub data is unavailable."


def test_check_repo_reports_commit_weeks_languages_and_pr_history() -> None:
    repo = _repo()
    week = int(datetime(2026, 10, 4, tzinfo=timezone.utc).timestamp())

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/runs"):
            return httpx.Response(200, json={"workflow_runs": []})
        if path.endswith("/stats/commit_activity"):
            weekly = {"week": week, "total": 3, "days": [0, 1, 2, 0, 0, 0, 0]}
            return httpx.Response(200, json=[weekly])
        if path.endswith("/languages"):
            return httpx.Response(200, json={"Python": 900, "TypeScript": 100})
        if path.endswith("/pulls"):
            assert request.url.params["state"] == "all"
            merged = {
                "number": 1,
                "state": "closed",
                "title": "done",
                "html_url": "https://x/1",
                "created_at": "2026-10-01T00:00:00Z",
                "merged_at": "2026-10-02T00:00:00Z",
            }
            return httpx.Response(200, json=[merged])
        return httpx.Response(200, json=[])

    async def run() -> object:
        monitor = GitHubMonitor(token="fixture-token")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await monitor._check_repo(client, repo)

    result = asyncio.run(run())

    assert result.open_pr_count == 0  # closed PRs are history, not open
    assert result.languages == {"Python": 900, "TypeScript": 100}
    assert result.commit_weeks[0].week == datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert result.commit_weeks[0].days == [0, 1, 2, 0, 0, 0, 0]
    assert result.pull_request_history[0].merged_at == datetime(2026, 10, 2, tzinfo=timezone.utc)


def test_activity_discovers_repos_from_github(monkeypatch) -> None:
    import app.github_monitor as gm

    listing = [
        {"name": "widgets", "owner": {"login": "isaacsilver13"}, "private": False},
        {"name": "new_thing", "owner": {"login": "isaacsilver13"}, "private": True},
        {"name": "old", "owner": {"login": "isaacsilver13"}, "archived": True},
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/user/repos":
            return httpx.Response(200, json=listing)
        is_actions = "actions" in str(request.url)
        return httpx.Response(200, json={"workflow_runs": []} if is_actions else [])

    original_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original_client(*args, **kwargs)

    monkeypatch.setattr(gm.httpx, "AsyncClient", patched_client)

    result = asyncio.run(GitHubMonitor(token="fixture-token").activity((_repo(),)))

    by_repo = {item.repo: item for item in result}
    assert set(by_repo) == {"widgets", "new_thing"}  # archived repo skipped
    assert by_repo["widgets"].name == "Fixture"  # curated name kept
    assert by_repo["new_thing"].repo_id == "new-thing"
    assert by_repo["new_thing"].private is True


def test_ci_status_only_real_failures_count_as_failure() -> None:
    assert _ci_status("completed", "failure") == "failure"
    assert _ci_status("completed", "timed_out") == "failure"
    # A bot PR's run waiting for approval is pending, not broken.
    assert _ci_status("completed", "action_required") == "in_progress"
    assert _ci_status("completed", "cancelled") == "unknown"
    assert _ci_status("completed", "skipped") == "unknown"
    assert _ci_status("in_progress", None) == "in_progress"
