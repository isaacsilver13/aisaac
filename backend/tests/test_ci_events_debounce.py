import asyncio

import httpx

from app import ci_events, main
from app.main import app


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.request(method, path, **kwargs)


def _post_ci_report(
    app_id: str, secret: str = "test-secret", ci_status: str = "success"
) -> httpx.Response:
    return asyncio.run(
        _request(
            "POST",
            "/internal/ci-report",
            json={
                "app_id": app_id,
                "repo": "isaacsilver13/vinyl",
                "event_type": "status_report",
                "ci_status": ci_status,
                "details": "all clear",
            },
            headers={"x-internal-secret": secret},
        )
    )


def _setup(monkeypatch, tmp_path, debounce_minutes=10.0):
    monkeypatch.setattr(main.settings, "internal_report_secret", "test-secret")
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read-token")
    monkeypatch.setattr(main.settings, "coms_debounce_minutes", debounce_minutes)
    ci_events.configure(str(tmp_path / "ci_events.db"))
    main._last_notified_at.clear()

    calls = []
    monkeypatch.setattr(main.notify, "send_coms_notification", lambda s, m: calls.append(m))
    return calls


def test_successful_ci_report_is_recorded_without_notification(monkeypatch, tmp_path) -> None:
    calls = _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(main.time, "monotonic", lambda: 1000.0)

    response = _post_ci_report("vinyl")

    assert response.status_code == 204
    assert calls == []

    history = asyncio.run(
        _request("GET", "/api/v1/coms", headers={"X-Dashboard-Token": "read-token"})
    ).json()
    assert len(history) == 1
    assert history[0]["notified"] is False


def test_first_failed_ci_report_notifies(monkeypatch, tmp_path) -> None:
    calls = _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(main.time, "monotonic", lambda: 1000.0)

    response = _post_ci_report("vinyl", ci_status="failure")

    assert response.status_code == 204
    assert len(calls) == 1


def test_second_event_within_debounce_window_records_but_does_not_notify(
    monkeypatch, tmp_path
) -> None:
    calls = _setup(monkeypatch, tmp_path, debounce_minutes=10.0)
    clock = {"now": 1000.0}
    monkeypatch.setattr(main.time, "monotonic", lambda: clock["now"])

    _post_ci_report("vinyl", ci_status="failure")
    clock["now"] += 60  # 1 minute later, well inside the 10-minute window
    response = _post_ci_report("vinyl", ci_status="failure")

    assert response.status_code == 204
    assert len(calls) == 1

    history = asyncio.run(
        _request("GET", "/api/v1/coms", headers={"X-Dashboard-Token": "read-token"})
    ).json()
    by_id = {row["id"]: row["notified"] for row in history}
    assert sorted(by_id.items()) == [(1, True), (2, False)]


def test_event_after_debounce_window_elapses_notifies_again(monkeypatch, tmp_path) -> None:
    calls = _setup(monkeypatch, tmp_path, debounce_minutes=10.0)
    clock = {"now": 1000.0}
    monkeypatch.setattr(main.time, "monotonic", lambda: clock["now"])

    _post_ci_report("vinyl", ci_status="failure")
    clock["now"] += 601  # just past the 10-minute (600s) window
    _post_ci_report("vinyl", ci_status="failure")

    assert len(calls) == 2


def test_debounce_is_per_app_id(monkeypatch, tmp_path) -> None:
    calls = _setup(monkeypatch, tmp_path, debounce_minutes=10.0)
    monkeypatch.setattr(main.time, "monotonic", lambda: 1000.0)

    _post_ci_report("vinyl", ci_status="failure")
    _post_ci_report("nba-prediction", ci_status="failure")

    assert len(calls) == 2
