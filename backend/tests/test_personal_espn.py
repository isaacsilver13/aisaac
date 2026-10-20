from datetime import datetime, timezone

from app import personal_espn, personal_sports, personal_store

NOW = datetime(2026, 10, 19, 14, 0, tzinfo=timezone.utc)


def _team(name, side, score=None, rank=99):
    return {"homeAway": side, "team": {"displayName": name}, "score": score,
            "curatedRank": {"current": rank}}


def _event(eid, home, away, state="pre", time_valid=True, date="2026-10-20T00:15Z"):
    return {
        "id": eid, "date": date,
        "links": [{"rel": ["summary", "desktop", "event"], "href": f"https://www.espn.com/g/{eid}"}],
        "competitions": [{
            "timeValid": time_valid,
            "status": {"type": {"state": state, "name": "STATUS_X"}},
            "competitors": [home, away],
        }],
    }


SCOREBOARD = {"events": [
    _event("1", _team("Chicago Bears", "home"), _team("Green Bay Packers", "away")),
    _event("2", _team("Ohio State Buckeyes", "home", rank=3), _team("Iowa Hawkeyes", "away"),
           state="post"),
]}
SCHEDULE = {"events": [
    _event("3", _team("Oregon Ducks", "home"), _team("Northwestern Wildcats", "away", rank=24),
           time_valid=False),  # TBD kickoff
    _event("4", _team("Temple Owls", "home", {"value": 21.0, "displayValue": "21"}),
           _team("Navy Midshipmen", "away", {"value": 14.0}), state="post",
           date="2026-09-01T17:00Z"),
]}
RANKINGS = {"rankings": [{"name": "AP Top 25", "date": "2026-10-18T07:00Z"}]}


def fake_get(path, params):
    if path.endswith("/rankings"):
        return RANKINGS
    if "/teams/" in path:
        return SCHEDULE
    return SCOREBOARD if path.startswith("football/nfl") else {"events": []}


def test_to_raw_maps_status_scores_ranks_and_links():
    raws = {r["id"]: r for r in personal_espn.fetch(fake_get, NOW)}
    bears = raws["espn-1"]
    assert bears["home"] == "Chicago Bears" and bears["status"] == "scheduled"
    assert bears["home_score"] is None and bears["home_rank"] is None and bears["poll_date"] is None
    assert bears["url"] == "https://www.espn.com/g/1"
    assert raws["espn-2"]["home_rank"] == 3 and raws["espn-2"]["status"] == "final"
    assert raws["espn-4"]["home_score"] == 21.0  # schedule pages nest the score
    assert "espn-3" not in raws  # TBD kickoff skipped


def test_fetch_requests_single_days_and_college_schedules():
    seen = []
    personal_espn.fetch(lambda p, q: seen.append((p, q)) or {"events": []}, NOW)
    dates = {q["dates"] for p, q in seen if "dates" in q}
    assert all("-" not in d for d in dates) and "20261019" in dates
    assert any(p.endswith("teams/77/schedule") for p, _ in seen)


def test_espn_rows_survive_normalize_and_priority_lookup(tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    assert personal_sports.refresh(lambda: personal_espn.fetch(fake_get, NOW)) == "ok"
    ids = [e["id"] for e in personal_sports.priority_events(NOW, days=7)]
    assert ids == ["espn-1"]  # Temple's September game is outside the window


GAME = {"id": "g1", "league": "NBA", "home": "Chicago Bulls", "away": "Toronto Raptors",
        "start_at": "2026-10-19T15:30:00Z", "status": "scheduled"}  # 10:30 CDT, 90 min after NOW


def _reminders(now, sent, ok=True, dry_run=False):
    def send(msg):
        sent.append(msg)
        return ok

    return personal_sports.send_reminders(
        now, send=send, dry_run=dry_run, refresh_fn=lambda: personal_sports.refresh(lambda: [GAME])
    )


def test_reminder_fires_once_inside_lead_window(tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    sent = []
    assert _reminders(NOW, sent)["sent"] == 0  # 90 min out: too early
    soon = NOW.replace(minute=45)  # 45 min out
    assert _reminders(soon, sent, dry_run=True)["due"][0].startswith("Toronto Raptors @ Chicago")
    assert sent == []  # dry run sends nothing
    assert _reminders(soon, sent)["sent"] == 1
    assert _reminders(soon.replace(minute=50), sent)["sent"] == 0  # never twice
    assert len(sent) == 1 and "10:30 AM CT" in sent[0]


def test_failed_push_retries_next_tick(tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    sent = []
    soon = NOW.replace(minute=45)
    assert _reminders(soon, sent, ok=False)["sent"] == 0
    assert _reminders(soon.replace(minute=59), sent)["sent"] == 1
    assert len(sent) == 2


def test_started_game_is_not_reminded(tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    sent = []
    _reminders(NOW, sent)  # loads the game
    assert _reminders(NOW.replace(hour=15, minute=31), sent)["sent"] == 0
