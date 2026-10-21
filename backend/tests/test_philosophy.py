import asyncio
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app import daily_pushes, main, personal_philosophy, personal_store

DAY = date(2026, 10, 21)
FIELDS = ("id", "school", "author", "source", "passage", "theme", "morning_prompt",
          "evening_question")


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "dashboard_write_token", "write")


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def test_corpus_is_complete_and_alternates_schools():
    entries = personal_philosophy.ENTRIES
    assert len(entries) >= 60 and len(entries) % 2 == 0
    assert len({e["id"] for e in entries}) == len(entries)
    for e in entries:
        assert all(isinstance(e[f], str) and e[f].strip() for f in FIELDS), e["id"]
        assert isinstance(e["paraphrase"], bool)
    for author in ("Jean-Paul Sartre", "Albert Camus", "Simone de Beauvoir"):
        assert all(e["paraphrase"] for e in entries if e["author"] == author)
    schools = [personal_philosophy.entry_for(DAY + timedelta(days=i))["school"] for i in range(70)]
    assert all(a != b for a, b in zip(schools, schools[1:]))
    assert set(schools) == {"stoic", "existentialist"}


def test_same_date_same_entry():
    assert personal_philosophy.entry_for(DAY) == personal_philosophy.entry_for(date(2026, 10, 21))


def test_push_kinds_registered_with_hours():
    assert daily_pushes.PUSHES["philosophy_morning"][0] == 7
    assert daily_pushes.PUSHES["philosophy_evening"][0] == 21
    morning = daily_pushes.PUSHES["philosophy_morning"][1](DAY)
    entry = personal_philosophy.entry_for(DAY)
    assert morning.startswith(entry["author"] + ": ") and entry["morning_prompt"] in morning
    assert len(morning) < 280 + 300
    assert daily_pushes.PUSHES["philosophy_evening"][1](DAY) == entry["evening_question"]


def test_morning_and_evening_pushes_send_at_their_hours():
    personal_store.set_push_pref("philosophy_morning", True)
    personal_store.set_push_pref("philosophy_evening", True)
    sent = []

    def send(message):
        sent.append(message)
        return True

    at_7 = datetime(2026, 10, 21, 12, 5, tzinfo=timezone.utc)  # 07:05 CDT
    at_21 = datetime(2026, 10, 22, 2, 5, tzinfo=timezone.utc)  # 21:05 CDT on the 21st
    result = daily_pushes.run(at_7, send)
    assert result["philosophy_morning"] == "sent" and result["philosophy_evening"] == "not_due"
    result = daily_pushes.run(at_21, send)
    assert result["philosophy_morning"] == "already_sent"
    assert result["philosophy_evening"] == "sent"
    assert sent[1] == personal_philosophy.entry_for(DAY)["evening_question"]


def test_journal_upsert_keeps_other_field():
    entry_id = personal_philosophy.entry_for(DAY)["id"]
    personal_store.upsert_journal("2026-10-21", entry_id, "Be patient", None)
    row = personal_store.upsert_journal("2026-10-21", entry_id, None, "Mostly was.")
    assert row["intention"] == "Be patient" and row["reflection"] == "Mostly was."


def test_endpoints_enforce_auth_and_round_trip():
    read, write = {"X-Dashboard-Token": "read"}, {"X-Dashboard-Write-Token": "write"}
    today = "/api/v1/personal/philosophy/today?day=2026-10-21"
    put = "/api/v1/personal/philosophy/journal/2026-10-21"
    history = "/api/v1/personal/philosophy/journal"
    assert _request("GET", today).status_code == 401
    assert _request("GET", history).status_code == 401
    assert _request("PUT", put, json={"intention": "x"}, headers=read).status_code == 401

    body = _request("GET", today, headers=read).json()
    assert body["entry"] == personal_philosophy.entry_for(DAY) and body["journal"] is None

    assert _request("PUT", put, json={"intention": "Be patient"}, headers=write).status_code == 200
    saved = _request("PUT", put, json={"reflection": "Mostly was."}, headers=write).json()
    assert saved["intention"] == "Be patient" and saved["reflection"] == "Mostly was."
    assert _request("GET", today, headers=read).json()["journal"]["reflection"] == "Mostly was."

    rows = _request("GET", history, headers=read).json()
    assert rows[0]["local_date"] == "2026-10-21"
    assert rows[0]["author"] == personal_philosophy.entry_for(DAY)["author"]

    too_long = {"reflection": "x" * 5001}
    assert _request("PUT", put, json=too_long, headers=write).status_code == 422
    bad_date = "/api/v1/personal/philosophy/journal/not-a-date"
    assert _request("PUT", bad_date, json={}, headers=write).status_code == 422
