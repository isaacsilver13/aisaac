import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from app import main, personal_digest, personal_news, personal_store

NOW = datetime(2026, 10, 7, 14, 0, tzinfo=timezone.utc)  # 09:00 CDT

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Fed holds rates as inflation cools</title>
<link>https://Example.com/a/?utm_source=x&amp;id=1#frag</link>
<pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Same story again</title><link>https://example.com/a?id=1</link>
<pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Ancient</title><link>https://example.com/old</link>
<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>"""

ATOM = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A proof</title>
<link href="https://example.org/p"/><updated>2026-10-07T10:00:00Z</updated></entry></feed>"""

FEEDS = (("https://f/1", "Feed One", "economics"),)


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    monkeypatch.setattr(personal_news, "FEEDS", FEEDS)
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "dashboard_write_token", "write")
    monkeypatch.setattr(main.settings, "internal_report_secret", "secret")


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def test_migration_is_idempotent_and_non_destructive(tmp_path):
    personal_news.refresh(lambda _: RSS, NOW)
    personal_store.configure(personal_store._db_path)  # re-run migrations
    assert len(personal_store.list_items()) == 1


def test_parse_normalizes_dedupes_and_drops_old():
    personal_news.refresh(lambda _: RSS, NOW)
    items = personal_store.list_items()
    assert [i["url"] for i in items] == ["https://example.com/a?id=1"]  # tracking/fragment gone
    assert "inflation" in items[0]["why"] and items[0]["topic"] == "economics"


def test_atom_parses():
    assert personal_news.parse_feed(ATOM)[0]["url"] == "https://example.org/p"


def test_dtd_rejected():
    with pytest.raises(ValueError):
        personal_news.parse_feed(b'<!DOCTYPE x [<!ENTITY a "b">]><rss/>')


def test_failure_keeps_last_snapshot_and_stores_code_only():
    personal_news.refresh(lambda _: RSS, NOW)
    ok_at = personal_store.freshness_at()

    def boom(_):
        raise httpx.ConnectError("secret upstream detail")

    personal_news.refresh(boom, NOW)
    assert len(personal_store.list_items()) == 1
    feed = personal_store.list_feeds()[0]
    assert feed["last_error"] == "fetch_failed" and feed["last_ok_at"] == ok_at


def test_state_survives_refresh_and_dismissed_hidden():
    personal_news.refresh(lambda _: RSS, NOW)
    item_id = personal_store.list_items()[0]["id"]
    assert personal_store.set_state(item_id, "dismissed")
    personal_news.refresh(lambda _: RSS, NOW)
    assert personal_store.list_items() == []
    assert len(personal_store.list_items(state="dismissed")) == 1


def test_auth_gates():
    assert _request("GET", "/api/v1/personal/news").status_code == 401
    read = {"X-Dashboard-Token": "read"}
    assert _request("GET", "/api/v1/personal/news", headers=read).status_code == 200
    r = _request("POST", "/api/v1/personal/news/1/state", json={"state": "saved"},
                 headers={"X-Dashboard-Token": "read"})
    assert r.status_code == 401  # a read token can never write
    assert _request("POST", "/internal/daily-digest/send").status_code == 401
    r = _request("GET", "/api/v1/personal/news?topic=nope", headers={"X-Dashboard-Token": "read"})
    assert r.status_code == 422


def test_state_endpoint_with_write_token():
    personal_news.refresh(lambda _: RSS, NOW)
    item_id = personal_store.list_items()[0]["id"]
    ok = _request("POST", f"/api/v1/personal/news/{item_id}/state", json={"state": "saved"},
                  headers={"X-Dashboard-Write-Token": "write"})
    assert ok.status_code == 204 and personal_store.list_items()[0]["state"] == "saved"
    missing = _request("POST", "/api/v1/personal/news/999/state", json={"state": "saved"},
                       headers={"X-Dashboard-Write-Token": "write"})
    assert missing.status_code == 404


def _run(now, sent, ok=True, dry_run=False):
    def send(subject, text, html):
        sent.append((subject, text, html))
        return ok

    return personal_digest.run(
        now, dry_run=dry_run, send=send, refresh=lambda: personal_news.refresh(lambda _: RSS, now)
    )


def test_digest_sends_once_per_local_day_across_retries():
    sent = []
    assert _run(NOW, sent)["status"] == "sent"
    assert _run(NOW.replace(hour=15), sent)["status"] == "already_handled"
    assert len(sent) == 1
    assert "example.com/a?id=1" in sent[0][1]


def test_digest_too_early_is_noop_and_dry_run_sends_nothing():
    sent = []
    early = datetime(2026, 10, 7, 12, 59, tzinfo=timezone.utc)  # 07:59 CDT
    assert _run(early, sent)["status"] == "too_early"
    assert personal_store.get_run("2026-10-07") is None
    assert _run(NOW, sent, dry_run=True)["status"] == "dry_run"
    assert sent == [] and personal_store.get_run("2026-10-07") is None


def test_digest_unsent_email_can_be_retried():
    sent = []
    assert _run(NOW, sent, ok=False)["status"] == "skipped"
    assert _run(NOW, sent, ok=True)["status"] == "sent"


def test_digest_failure_releases_slot():
    def explode(*_):
        raise RuntimeError("x")

    with pytest.raises(RuntimeError):
        personal_digest.run(NOW, send=explode, refresh=lambda: None)
    assert personal_store.get_run("2026-10-07")["status"] == "failed"
    assert _run(NOW, [])["status"] == "sent"


def test_digest_key_is_chicago_date_across_dst():
    # 2026-11-01 DST ends: 08:00 CST is 14:00Z; 08:00 CDT the day before is 13:00Z.
    def at(*args):
        return datetime(*args, tzinfo=timezone.utc)

    assert personal_digest.local_date(at(2026, 11, 1, 4, 30)) == "2026-10-31"  # 23:30 CDT
    assert personal_digest.local_date(at(2026, 11, 1, 5, 30)) == "2026-11-01"  # 00:30 CDT
    sent = []
    assert _run(at(2026, 11, 1, 13, 0), sent)["status"] == "too_early"  # 07:00 CST
    assert _run(at(2026, 11, 1, 14, 0), sent)["status"] == "sent"  # 08:00 CST
    assert _run(at(2026, 11, 1, 15, 0), sent)["status"] == "already_handled"
    assert _run(at(2026, 3, 8, 13, 0), sent)["status"] == "sent"  # 08:00 CDT


def test_render_escapes_html():
    items = [{"topic": "x", "title": "<script>", "source": "s", "url": "https://a/b?x=1&y=2"}]
    _, text, html = personal_digest.render(items, None, NOW)
    assert "<script>" not in html and "&lt;script&gt;" in html and "freshness unknown" in text


def test_digest_endpoint_dry_run():
    r = _request(
        "POST", "/internal/daily-digest/send?dry_run=true", headers={"X-Internal-Secret": "secret"}
    )
    assert r.status_code == 200 and r.json()["status"] == "dry_run"


def test_keywords_match_whole_words_and_digest_caps_per_topic():
    _, why = personal_news.score_item("He said again", "technology", NOW, NOW)
    assert "matches" not in why  # "ai" must not match inside "said"/"again"
    for i in range(5):
        personal_store.upsert_item({
            "url": f"https://x/{i}", "title": f"t{i}", "source": "s", "topic": "economics",
            "published_at": NOW.isoformat(), "score": 1.0, "why": "w",
        })
    assert len(personal_digest.pick_items()) == personal_digest.PER_TOPIC


def test_read_items_leave_the_digest_and_lead_story_renders():
    personal_news.refresh(lambda _: RSS, NOW)
    items = personal_store.list_items()
    r = _request("POST", f"/api/v1/personal/news/{items[0]['id']}/state", json={"state": "read"},
                 headers={"X-Dashboard-Write-Token": "write"})
    assert r.status_code == 204
    assert items[0]["id"] not in {i["id"] for i in personal_digest.pick_items()}
    _, text, html = personal_digest.render(items, None, NOW)
    assert "Lead story" in text and 'class="d-card"' in html and "prefers-color-scheme" in html


def test_utf16_doctype_rejected():
    doc = '<!DOCTYPE x [<!ENTITY a "b">]><rss version="2.0"/>'.encode("utf-16")
    with pytest.raises(ValueError):
        personal_news.parse_feed(doc)
