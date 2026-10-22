import asyncio
import copy
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app import daily_pushes, main, personal_nba, personal_store

SECRET = {"X-Internal-Secret": "secret"}
READ = {"X-Dashboard-Token": "read"}

# The example from bet_watch PR #11 ("Report payload"), the contract this endpoint accepts.
REPORT = {
    "kind": "nba_daily_report",
    "slate_date": "2026-10-21",
    "generated_at": "2026-10-21T15:15:04+00:00",
    "model_version": "margin-noline-df6993e1",
    "data_through": "2026-10-20",
    "odds_as_of": "2026-10-21T15:00:00+00:00",
    "games": [
        {"game_id": 1, "home": "GSW", "away": "NYK", "tip": "2026-10-22T02:00:00+00:00",
         "pred_margin": 10.0, "p_home_win": 0.8,
         "market_spread_home": -7.5, "market_home_win_prob": 0.726, "books": 5}
    ],
    "picks": [
        {"tier": "targeted", "game_id": 1, "home": "GSW", "away": "NYK",
         "tip": "2026-10-22T02:00:00+00:00", "market": "moneyline", "side": "home",
         "team": "GSW", "line": None, "book": "betrivers", "price_american": -295,
         "model_prob": 0.8, "market_prob": 0.726, "ev": 0.0712, "kelly_frac": 0.063},
        {"tier": "watchlist", "game_id": 1, "home": "GSW", "away": "NYK",
         "tip": "2026-10-22T02:00:00+00:00", "market": "spread", "side": "home",
         "team": "GSW", "line": -7.5, "book": "betrivers", "price_american": -105,
         "model_prob": 0.571, "market_prob": 0.4962, "ev": 0.1148, "kelly_frac": 0.0362},
    ],
    "track_record": [
        {"tier": "targeted", "picks": 1, "graded": 0, "won": 0, "lost": 0, "push": 0,
         "flat_roi": None, "avg_clv": None, "clv_samples": 0, "beat_close_pct": None},
        {"tier": "watchlist", "picks": 1, "graded": 0, "won": 0, "lost": 0, "push": 0,
         "flat_roi": None, "avg_clv": None, "clv_samples": 0, "beat_close_pct": None},
    ],
}


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def _post(body, headers=SECRET):
    return _request("POST", "/internal/nba-report", json=body, headers=headers)


def _report(slate_date, **changes):
    return {**copy.deepcopy(REPORT), "slate_date": slate_date, **changes}


def test_post_and_get_need_their_secrets():
    assert _post(REPORT, headers={}).status_code == 401
    assert _post(REPORT, headers={"X-Internal-Secret": "wrong"}).status_code == 401
    assert _post(REPORT, headers=READ).status_code == 401
    assert _request("GET", "/api/v1/personal/nba-report").status_code == 401
    assert _request("GET", "/api/v1/personal/nba-report", headers=SECRET).status_code == 401


def test_contract_example_round_trips():
    r = _post(REPORT)
    assert r.status_code == 200 and r.json()["slate_date"] == "2026-10-21"
    body = _request("GET", "/api/v1/personal/nba-report?date=2026-10-21", headers=READ).json()
    assert body["picks"] == REPORT["picks"] and body["games"] == REPORT["games"]
    assert body["track_record"] == REPORT["track_record"] and body["received_at"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(kind="other_report"),
        lambda b: b.update(stake=25),
        lambda b: b["picks"][0].update(stake_dollars=25.0),
        lambda b: b["picks"][0].update(tier="lock"),
        lambda b: b["track_record"][0].update(bankroll=1000),
        lambda b: b["games"][0].update(balance=50),
        lambda b: b.pop("picks"),
        lambda b: b.update(slate_date="not-a-date"),
    ],
)
def test_rejects_bad_kind_stakes_dollars_and_missing_fields(mutate):
    body = copy.deepcopy(REPORT)
    mutate(body)
    assert _post(body).status_code == 422
    assert personal_store.get_nba_report() is None


def test_resend_of_a_slate_replaces_it():
    _post(REPORT)
    _post(_report("2026-10-21", picks=[]))
    stored = personal_store.get_nba_report("2026-10-21")
    assert stored["picks"] == []
    with personal_store._connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM nba_reports").fetchone()[0] == 1


def test_get_without_date_returns_latest_and_missing_date_is_null():
    _post(_report("2026-10-20"))
    _post(_report("2026-10-21"))
    _post(_report("2026-10-19"))
    latest = _request("GET", "/api/v1/personal/nba-report", headers=READ).json()
    assert latest["slate_date"] == "2026-10-21"
    r = _request("GET", "/api/v1/personal/nba-report?date=2026-10-01", headers=READ)
    assert r.status_code == 200 and r.json() is None


def test_reports_older_than_30_days_are_dropped():
    today = datetime.now(timezone.utc).date()
    old, kept = (today - timedelta(days=31)).isoformat(), (today - timedelta(days=29)).isoformat()
    for d in (old, kept):
        personal_store.upsert_nba_report(d, {"slate_date": d})
    assert personal_store.get_nba_report(old) is None
    assert personal_store.get_nba_report(kept) is not None


def test_push_waits_for_the_report_then_names_the_top_targeted_pick():
    day = date(2026, 10, 21)
    hour, build = daily_pushes.PUSHES["nba_report"]
    assert hour == 10 and build is personal_nba.push_message
    assert build(day) is None
    _post(REPORT)
    assert build(day) == "1 targeted bet today — top: GSW -295 @ betrivers, EV 7.1%"

    second = {**REPORT["picks"][0], "team": "NYK", "side": "away", "price_american": 240,
              "book": "fanduel", "ev": 0.094}
    _post(_report("2026-10-21", picks=[REPORT["picks"][0], second, REPORT["picks"][1]]))
    assert build(day) == "2 targeted bets today — top: NYK +240 @ fanduel, EV 9.4%"

    _post(_report("2026-10-21", picks=[REPORT["picks"][1]]))
    assert build(day) == "No targeted bets today"


def test_hourly_job_retries_until_report_then_sends_once():
    personal_store.set_push_pref("nba_report", True)
    sent = []
    at_10 = datetime(2026, 10, 21, 15, 5, tzinfo=timezone.utc)  # 10:05 CDT
    at_11 = datetime(2026, 10, 21, 16, 5, tzinfo=timezone.utc)
    send = lambda m: sent.append(m) or True  # noqa: E731
    assert daily_pushes.run(at_10, send)["nba_report"] == "not_ready"
    _post(REPORT)
    assert daily_pushes.run(at_11, send)["nba_report"] == "sent"
    assert daily_pushes.run(at_11, send)["nba_report"] == "already_sent"
    assert sent == ["1 targeted bet today — top: GSW -295 @ betrivers, EV 7.1%"]


def test_push_is_off_by_default():
    assert not personal_store.get_push_prefs().get("nba_report")
