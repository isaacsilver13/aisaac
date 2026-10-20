import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from app import main, metrics_store, personal_assistant, personal_sports, personal_store

NOW = datetime(2026, 10, 19, 13, 0, tzinfo=timezone.utc)  # Mon 08:00 CDT

GAMES = [
    {"id": "bulls", "league": "NBA", "home": "Chicago Bulls", "away": "Toronto Raptors",
     "start_at": "2026-10-20T00:00:00Z", "status": "scheduled"},  # Mon 19:00 CDT
    {"id": "lakers", "league": "NBA", "home": "Los Angeles Lakers", "away": "Boston Celtics",
     "start_at": "2026-10-20T02:30:00Z", "status": "scheduled"},
    {"id": "osu", "league": "NCAAF", "home": "Ohio State Buckeyes", "away": "Iowa Hawkeyes",
     "home_rank": 3, "poll_date": "2026-10-18", "start_at": "2026-10-19T20:00:00Z"},
    {"id": "nextweek", "league": "NFL", "home": "Chicago Bears", "away": "Green Bay Packers",
     "start_at": "2026-10-26T17:00:00Z", "status": "scheduled"},
]


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    metrics_store.configure(str(tmp_path / "m.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")
    personal_sports.refresh(lambda: GAMES)


def test_games_split_priority_top25_and_slate_without_repeats():
    g = personal_assistant.games(NOW)
    assert [x["id"] for x in g["priority"]] == ["bulls"]
    assert [x["id"] for x in g["top_25"]] == ["osu"]
    assert [x["id"] for x in g["slate"]["NBA"]] == ["lakers"]  # Bulls not listed twice
    assert g["slate"]["NFL"] == []  # next week's game is not today's slate


def _build(**kw):
    async def activity():
        return []

    args = {"activity": activity, "calendar_url": "", "gym_url": "", "gym_token": ""} | kw
    return asyncio.run(personal_assistant.build(NOW, **args))


def test_brief_sections_report_their_own_state():
    brief = _build()
    assert brief["calendar"]["state"] == "not_connected"
    assert brief["projects"]["state"] == "not_connected"
    assert brief["gym"]["state"] == "not_connected"
    assert brief["games"]["priority"][0]["id"] == "bulls"


def test_push_line_summarises_and_links():
    brief = _build()
    brief["calendar"] = {"state": "ok", "events": [{}, {}]}
    brief["projects"]["projects"] = [{"reasons": ["latest CI run failed"]}, {"reasons": []}]
    brief["gym"]["data"] = {"next_gym_day": {"name": "Push"}}
    line = personal_assistant.push_line(brief, "https://a/assistant")
    assert line == (
        "2 events · 1 project need you · Toronto Raptors @ Chicago Bulls Mon 7:00 PM · Gym: Push"
        "\nhttps://a/assistant"
    )


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def test_brief_endpoint_needs_read_token():
    assert _request("GET", "/api/v1/personal/assistant").status_code == 401
    r = _request("GET", "/api/v1/personal/assistant", headers={"X-Dashboard-Token": "read"})
    assert r.status_code == 200 and set(r.json()) >= {"calendar", "projects", "games", "gym"}


def test_digest_dry_run_includes_brief_and_never_pushes(monkeypatch):
    pushed = []
    monkeypatch.setattr(main.notify, "send_coms_notification", lambda *a: pushed.append(a))
    r = _request("POST", "/internal/daily-digest/send?dry_run=true",
                 headers={"X-Internal-Secret": "secret"})
    assert r.status_code == 200 and r.json()["status"] == "dry_run"
    assert pushed == []
