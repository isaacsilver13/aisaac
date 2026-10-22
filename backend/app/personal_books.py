"""Books agent: audiobook recommendations and per-book concept maps (Groq free tier).

The LLM suggests books; a book is kept only if the keyless iTunes Search API finds it as an
audiobook (Audible and Libby have no public API, so they get search links, never claimed as
verified). Concept maps come from the model's knowledge of the book, not the audio, so the UI
labels them "AI-generated outline". Errors surface as short codes, never upstream bodies.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Optional
from urllib.parse import quote_plus

import httpx
from pydantic import ValidationError

from . import daily_pushes, personal_store
from .schemas import BookMap

logger = logging.getLogger("aisaac.personal")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
ITUNES_URL = "https://itunes.apple.com/search"
MAX_RECOMMENDATIONS = 6
# Tests swap in httpx.MockTransport; None = real network.
TRANSPORT: Optional[httpx.BaseTransport] = None


class BooksError(Exception):
    """`code` is the short error code returned to the client; `status` its HTTP status."""

    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.code = code
        self.status = status


def _client() -> httpx.Client:
    return httpx.Client(transport=TRANSPORT, timeout=30)


def _groq_json(client: httpx.Client, api_key: str, model: str, prompt: str) -> object:
    """One JSON-mode chat completion, parsed. Raises BooksError on transport/HTTP errors."""
    if not api_key:
        raise BooksError("groq_not_configured", 503)
    try:
        response = client.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "response_format": {"type": "json_object"},
                "temperature": 0.4,
                "messages": [
                    {"role": "system", "content": "You reply with a single JSON object only."},
                    {"role": "user", "content": prompt},
                ],
            },
        )
    except httpx.HTTPError:
        raise BooksError("groq_unreachable") from None
    if response.status_code == 429:
        raise BooksError("groq_rate_limited", 429)
    if response.status_code >= 400:
        logger.warning("groq returned HTTP %s", response.status_code)
        raise BooksError("groq_failed")
    try:
        return json.loads(response.json()["choices"][0]["message"]["content"])
    except (ValueError, KeyError, IndexError, TypeError):
        return None  # caller treats unparseable content as bad output


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", text.lower()).split())


def _key(title: str, author: str) -> tuple[str, str]:
    """Main title (before any subtitle) and the author's surname, normalized."""
    return _norm(re.split(r"[:(]", title)[0]), (_norm(author).split() or [""])[-1]


def _matches(main: str, surname: str, item: dict) -> bool:
    return bool(main) and main in _norm(item.get("collectionName", "")) and (
        surname in _norm(item.get("artistName", ""))
    )


def _audiobook(client: httpx.Client, title: str, author: str) -> Optional[dict]:
    main, surname = _key(title, author)
    try:
        # Long subtitles derail iTunes search, so search on what the match checks.
        response = client.get(
            ITUNES_URL,
            params={"term": f"{main} {surname}", "media": "audiobook", "limit": 5},
        )
        response.raise_for_status()
        results = response.json().get("results", [])
    except (httpx.HTTPError, ValueError):
        return None  # unverifiable counts as not an audiobook
    return next((r for r in results if _matches(main, surname, r)), None)


def recommend(interest: str, api_key: str, model: str) -> list[dict]:
    """Up to 6 `{title, author, why, apple_url, audible_search_url, libby_search_url}`."""
    prompt = (
        f"Recommend 10 well-known non-fiction or fiction books for someone who wants to learn "
        f"about: {interest}\nPrefer books that exist as audiobooks. Reply as "
        '{"books": [{"title": str, "author": str, "why": "one sentence"}]}'
    )
    with _client() as client:
        data = _groq_json(client, api_key, model, prompt)
        candidates = data.get("books") if isinstance(data, dict) else None
        if not isinstance(candidates, list):
            raise BooksError("bad_recommendations")
        out: list[dict] = []
        for c in candidates:
            if len(out) >= MAX_RECOMMENDATIONS:
                break
            if not isinstance(c, dict):
                continue
            title, author = str(c.get("title") or "").strip(), str(c.get("author") or "").strip()
            if not title or not author or not (hit := _audiobook(client, title, author)):
                continue
            q = quote_plus(f"{title} {author}")
            out.append({
                "title": title,
                "author": author,
                "why": str(c.get("why") or "")[:300],
                "apple_url": hit.get("collectionViewUrl"),
                "audible_search_url": f"https://www.audible.com/search?keywords={q}",
                # OverDrive's catalogue search is Libby's, without picking a library.
                "libby_search_url": f"https://www.overdrive.com/search?q={q}",
            })
    return out


def build_map(title: str, author: str, api_key: str, model: str) -> dict:
    """A validated BookMap as a dict; one retry on invalid output, then BooksError('bad_map')."""
    prompt = (
        f'Outline the ideas of the book "{title}" by {author} as a concept map with 15-30 nodes. '
        'Reply as {"nodes": [{"id": "short-slug", "label": str, "kind": "theme"|"concept"|'
        '"example", "summary": "2-3 sentences"}], "edges": [{"source": node id, "target": '
        "node id, \"label\": short relation}]}. A few themes, concepts under them, examples "
        "under concepts. Every edge must use ids from nodes."
    )
    with _client() as client:
        for attempt in range(2):
            data = _groq_json(client, api_key, model, prompt)
            try:
                return BookMap.model_validate(data).model_dump()
            except ValidationError:
                logger.warning("book map invalid (attempt %s)", attempt + 1)
    raise BooksError("bad_map")


def push_message(day: date) -> Optional[str]:
    book = personal_store.listening_book()
    if book is None:
        return None
    nodes = sorted(book["map"]["nodes"], key=lambda n: n["id"])
    # Same rotation as learning.pick(): sorted ids, indexed by the Chicago date's ordinal.
    node = nodes[day.toordinal() % len(nodes)]
    return f"{book['title']}: {node['label']} — {node['summary']}"


daily_pushes.PUSHES["books"] = (9, push_message)
