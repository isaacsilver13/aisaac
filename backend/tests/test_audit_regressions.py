import asyncio
from datetime import datetime, timezone

import httpx

from app import ci_events, incidents, main
from app.github_monitor import GitHubMonitor
from app.monitoring import Monitor
from app.schemas import AppDefinition, CheckResult, RepoDefinition


def test_private_routes_reject_before_external_work(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, "dashboard_read_token", "fixture-read")
    ci_events.configure(str(tmp_path / "events.db"))
    ci_events.record_event("private", "owner/private", "ci", "failure", "private marker", False)

    async def no_call(*args, **kwargs):
        raise AssertionError("Unauthorized request must not trigger work")

    monkeypatch.setattr(main.monitor, "dashboard", no_call)
    monkeypatch.setattr(main.github_monitor, "activity", no_call)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            for path in ("/api/v1/dashboard?force_refresh=true",
                         "/api/v1/analytics?force_refresh=true", "/api/v1/coms"):
                for headers in ({}, {"X-Dashboard-Token": "incorrect"}):
                    response = await client.get(path, headers=headers)
                    assert response.status_code == 401
                    assert "private marker" not in response.text
            response = await client.get(
                "/api/v1/coms", headers={"X-Dashboard-Token": "fixture-read"}
            )
            assert response.status_code == 200
            assert response.json()[0]["details"] == "private marker"

    asyncio.run(check())


def test_startup_failure_and_recovery_use_persisted_incidents(tmp_path):
    incidents.configure(str(tmp_path / "incidents.db"))

    def result(state):
        return CheckResult(app_id="fixture", name="Fixture", category="Test", description="",
                           state=state, checked_at=datetime.now(timezone.utc))

    monitor = Monitor()
    monitor._handle_transition(result("down"))
    first = incidents.get_open_incident("fixture")
    assert first is not None
    monitor._handle_transition(result("down"))
    assert incidents.get_open_incident("fixture")["id"] == first["id"]
    # A process restart loses in-memory state, not the persisted incident.
    restarted = Monitor()
    restarted._handle_transition(result("stale"))
    assert incidents.get_open_incident("fixture") is not None
    restarted._handle_transition(result("up"))
    assert incidents.get_open_incident("fixture") is None


def test_health_refreshes_are_coalesced_and_forced_refresh_has_a_floor(monkeypatch):
    monitor = Monitor()
    calls = []
    monkeypatch.setattr(main.health_history, "record", lambda results: None)

    async def check_app(client, app):
        calls.append(app.id)
        await asyncio.sleep(0)
        return CheckResult(app_id=app.id, name="Fixture", category="Test", description="",
                           state="up", checked_at=datetime.now(timezone.utc))

    monkeypatch.setattr(monitor, "check_app", check_app)
    apps = (AppDefinition(id="fixture", name="Fixture", category="Test", description=""),)

    async def check():
        await asyncio.gather(*(monitor.dashboard(apps, force_refresh=True) for _ in range(10)))
        assert len(calls) == 1
        assert (await monitor.dashboard(apps, force_refresh=True))[0].cached

    asyncio.run(check())


def test_ci_is_independent_of_scheduled_jobs():
    repo = RepoDefinition(id="fixture", name="Fixture", category="Test", owner="owner",
                          repo="fixture", scheduled_workflows=("scheduled-tick.yml",))
    seen = []

    def handler(request):
        path = request.url.path
        if "/actions/" in path:
            seen.append(path)
            conclusion = "failure" if "scheduled-tick.yml" in path else "success"
            return httpx.Response(200, json={"workflow_runs": [
                {"status": "completed", "conclusion": conclusion}
            ]})
        return httpx.Response(200, json=[])

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await GitHubMonitor("fixture")._check_repo(client, repo)
            assert result.ci_status == "success"
            assert result.job_statuses == {"scheduled-tick.yml": "failure"}
        assert all("/actions/workflows/" in path for path in seen)

    asyncio.run(check())
