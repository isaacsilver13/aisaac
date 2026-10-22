import asyncio
import json
from datetime import date, timedelta

import httpx
import pytest

from app import daily_pushes, main, personal_books, personal_store

READ = {"X-Dashboard-Token": "read"}
WRITE = {"X-Dashboard-Write-Token": "write"}
DAY = date(2026, 10, 21)

MAP = {
    "nodes": [
        {"id": "risk", "label": "Risk", "kind": "theme", "summary": "Known odds."},
        {"id": "uncertainty", "label": "Uncertainty", "kind": "concept",
         "summary": "Unknown odds."},
        {"id": "poker", "label": "Poker hands", "kind": "example", "summary": "Bets on cards."},
    ],
    "edges": [{"source": "risk", "target": "uncertainty", "label": "contrasts"},
              {"source": "uncertainty", "target": "poker", "label": "example"}],
}
BOOKS = [
    {"title": "Thinking in Bets", "author": "Annie Duke", "why": "Decisions as bets."},
    {"title": "Made Up Book", "author": "Nobody Real", "why": "Hallucinated."},
    {"title": "Superforecasting: The Art and Science of Prediction",
     "author": "Philip E. Tetlock", "why": "Calibration."},
]
AUDIOBOOKS = {
    "thinking in bets": {"collectionName": "Thinking in Bets (Unabridged)",
                         "artistName": "Annie Duke", "collectionViewUrl": "https://apple/tib"},
    "superforecasting": {"collectionName": "Superforecasting: The Art and Science of Prediction",
                         "artistName": "Philip E. Tetlock & Dan Gardner",
                         "collectionViewUrl": "https://apple/sf"},
}


def _groq_reply(content) -> httpx.Response:
    text = content if isinstance(content, str) else json.dumps(content)
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


class Stub:
    """Groq + iTunes over httpx.MockTransport; `groq` is a queue of replies."""

    def __init__(self, *groq):
        self.groq = list(groq)
        self.groq_calls = 0
        self.itunes_terms: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.groq.com":
            self.groq_calls += 1
            assert request.headers["authorization"] == "Bearer gsk-test"
            assert json.loads(request.content)["response_format"] == {"type": "json_object"}
            return self.groq.pop(0)
        assert request.url.params["media"] == "audiobook"
        term = request.url.params["term"]
        self.itunes_terms.append(term)
        hits = [v for k, v in AUDIOBOOKS.items() if term.startswith(k)]
        # A same-title audiobook by someone else must not count as a match.
        hits.insert(0, {"collectionName": term, "artistName": "Some Narrator"})
        return httpx.Response(200, json={"results": hits})


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    personal_store.configure(str(tmp_path / "p.db"))
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "dashboard_write_token", "write")
    monkeypatch.setattr(main.settings, "groq_api_key", "gsk-test")


def _stub(monkeypatch, *groq) -> Stub:
    stub = Stub(*groq)
    monkeypatch.setattr(personal_books, "TRANSPORT", httpx.MockTransport(stub))
    return stub


def _request(method, url, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(run())


def test_recommend_keeps_only_verified_audiobooks(monkeypatch):
    _stub(monkeypatch, _groq_reply({"books": BOOKS}))
    r = _request("POST", "/api/v1/personal/books/recommend", headers=WRITE,
                 json={"interest": "decision making under uncertainty"})
    assert r.status_code == 200
    got = r.json()
    assert [b["title"] for b in got] == ["Thinking in Bets", BOOKS[2]["title"]]
    assert got[0]["apple_url"] == "https://apple/tib"
    assert got[0]["audible_search_url"].startswith("https://www.audible.com/search?keywords=")
    assert got[0]["libby_search_url"].startswith("https://www.overdrive.com/search?q=")


def test_recommend_caps_results_and_stops_searching(monkeypatch):
    many = [{"title": "Thinking in Bets", "author": "Annie Duke", "why": "x"}] * 10
    stub = _stub(monkeypatch, _groq_reply({"books": many}))
    got = personal_books.recommend("anything", "gsk-test", "m")
    assert len(got) == 6 and len(stub.itunes_terms) == 6


def test_build_map_retries_bad_output_once(monkeypatch):
    stub = _stub(monkeypatch, _groq_reply("not json"), _groq_reply(MAP))
    r = _request("POST", "/api/v1/personal/books", headers=WRITE,
                 json={"title": "Thinking in Bets", "author": "Annie Duke",
                       "apple_url": "https://apple/tib"})
    assert r.status_code == 201
    assert stub.groq_calls == 2
    book = r.json()
    assert book["status"] == "queued" and len(book["map"]["nodes"]) == 3


def test_build_map_fails_cleanly_after_second_bad_output(monkeypatch):
    dangling = {**MAP, "edges": [{"source": "risk", "target": "missing", "label": ""}]}
    stub = _stub(monkeypatch, _groq_reply(dangling), _groq_reply({"nodes": []}))
    r = _request("POST", "/api/v1/personal/books", headers=WRITE,
                 json={"title": "T", "author": "A"})
    assert r.status_code == 502 and r.json() == {"detail": "bad_map"}
    assert stub.groq_calls == 2
    assert personal_store.list_books() == []


def test_book_map_rejects_too_many_nodes_and_duplicate_ids():
    from pydantic import ValidationError

    from app.schemas import BookMap

    node = MAP["nodes"][0]
    with pytest.raises(ValidationError):
        BookMap.model_validate({"nodes": [{**node, "id": f"n{i}"} for i in range(41)]})
    with pytest.raises(ValidationError):
        BookMap.model_validate({"nodes": [node, node]})


def test_missing_groq_key_is_503(monkeypatch):
    monkeypatch.setattr(main.settings, "groq_api_key", "")
    stub = _stub(monkeypatch)
    r = _request("POST", "/api/v1/personal/books/recommend", headers=WRITE,
                 json={"interest": "x"})
    assert r.status_code == 503 and r.json() == {"detail": "groq_not_configured"}
    r = _request("POST", "/api/v1/personal/books", headers=WRITE,
                 json={"title": "T", "author": "A"})
    assert r.status_code == 503
    assert stub.groq_calls == 0


def test_groq_rate_limit_is_a_short_code(monkeypatch):
    _stub(monkeypatch, httpx.Response(429, text="secret upstream body"))
    r = _request("POST", "/api/v1/personal/books/recommend", headers=WRITE,
                 json={"interest": "x"})
    assert r.status_code == 429 and r.json() == {"detail": "groq_rate_limited"}


def test_tokens_enforced(monkeypatch):
    _stub(monkeypatch)
    book = personal_store.add_book("T", "A", None, MAP)
    writes = [("POST", "/api/v1/personal/books/recommend", {"interest": "x"}),
              ("POST", "/api/v1/personal/books", {"title": "T", "author": "A"}),
              ("PATCH", f"/api/v1/personal/books/{book['id']}", {"status": "done"})]
    for method, url, body in writes:
        assert _request(method, url, json=body).status_code == 401
        assert _request(method, url, json=body, headers=READ).status_code == 401
    for url in ("/api/v1/personal/books", f"/api/v1/personal/books/{book['id']}"):
        assert _request("GET", url).status_code == 401
        assert _request("GET", url, headers=WRITE).status_code == 401
        assert _request("GET", url, headers=READ).status_code == 200


def test_library_status_and_read(monkeypatch):
    book = personal_store.add_book("T", "A", "https://apple/t", MAP)
    r = _request("PATCH", f"/api/v1/personal/books/{book['id']}", headers=WRITE,
                 json={"status": "listening"})
    assert r.status_code == 200 and r.json()["status"] == "listening"
    assert _request("PATCH", "/api/v1/personal/books/999", headers=WRITE,
                    json={"status": "done"}).status_code == 404
    assert _request("PATCH", f"/api/v1/personal/books/{book['id']}", headers=WRITE,
                    json={"status": "lost"}).status_code == 422
    rows = _request("GET", "/api/v1/personal/books", headers=READ).json()
    assert rows == [{k: v for k, v in r.json().items() if k != "map"}]
    assert _request("GET", "/api/v1/personal/books/999", headers=READ).status_code == 404


def test_push_none_without_listening_book():
    assert daily_pushes.PUSHES["books"][0] == 9
    personal_store.add_book("T", "A", None, MAP)  # queued, not listening
    assert personal_books.push_message(DAY) is None


def test_push_rotates_one_node_a_day():
    book = personal_store.add_book("Thinking in Bets", "Annie Duke", None, MAP)
    personal_store.set_book_status(book["id"], "listening")
    week = [personal_books.push_message(DAY + timedelta(days=i)) for i in range(3)]
    assert len(set(week)) == 3
    assert personal_books.push_message(DAY) == personal_books.push_message(DAY)
    assert all(m.startswith("Thinking in Bets: ") for m in week)
    assert "Uncertainty — Unknown odds." in " ".join(week)


def test_books_push_is_off_by_default():
    assert personal_store.get_push_prefs().get("books") is None
