from datetime import datetime, timezone

from app import personal_calendar

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:standup
SUMMARY:Standup
DTSTART;TZID=America/Chicago:20261005T090000
DTEND;TZID=America/Chicago:20261005T091500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
EXDATE;TZID=America/Chicago:20261021T090000
END:VEVENT
BEGIN:VEVENT
UID:dentist
SUMMARY:Dentist
LOCATION:Evanston
DTSTART:20261019T200000Z
DTEND:20261019T210000Z
END:VEVENT
BEGIN:VEVENT
UID:bday
SUMMARY:Mom birthday
DTSTART;VALUE=DATE:20261019
DTEND;VALUE=DATE:20261020
END:VEVENT
BEGIN:VEVENT
UID:late
SUMMARY:Tomorrow 00:30 UTC is still today in Chicago
DTSTART:20261020T003000Z
END:VEVENT
END:VCALENDAR
"""

MONDAY = datetime(2026, 10, 19, 13, 0, tzinfo=timezone.utc)  # 08:00 CDT


def test_today_expands_recurrence_and_uses_chicago_day():
    out = personal_calendar.today("https://cal/x.ics", MONDAY, fetch=lambda _: ICS)
    assert out["state"] == "ok"
    titles = [e["title"] for e in out["events"]]
    assert titles[0] == "Mom birthday" and out["events"][0]["all_day"]  # all-day first
    assert titles[1:] == [
        "Standup", "Dentist", "Tomorrow 00:30 UTC is still today in Chicago"
    ]
    assert out["events"][2]["start"] == "2026-10-19T15:00:00-05:00"
    assert out["events"][2]["location"] == "Evanston"


def test_exdate_skips_cancelled_occurrence():
    wed = datetime(2026, 10, 21, 13, 0, tzinfo=timezone.utc)
    assert personal_calendar.today("u", wed, fetch=lambda _: ICS)["events"] == []


def test_unset_and_failed_states():
    assert personal_calendar.today("", MONDAY)["state"] == "not_connected"

    def boom(_):
        raise RuntimeError("https://secret-url leaked?")

    assert personal_calendar.today("u", MONDAY, fetch=boom) == {
        "state": "fetch_failed", "events": []
    }
