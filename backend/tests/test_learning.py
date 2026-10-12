import asyncio
from datetime import date

import httpx
import pytest

from app import learning, main, second_brain_store

MARKOV = """# Markov Chain

## Definition
A **Markov chain** predicts the next state from the current state only. [S: textbook]

## How It Works
- Generate by repeatedly sampling the next state from the current state's row.
- With one state of memory, a [[N-gram Language Model]] is locally fluent.

## Related Concepts
- [[N-gram Language Model]] - the Markov chain applied to word sequences.
- [[Tokenisation]] - how the state sequence is built.

## Sources
- [[textbook]] - definition and estimation.

## My Understanding
<!-- Written by the user. -->

## Open Questions
- [[How does smoothing handle zero-count bigrams?]]
"""


def _note(path, title, body):
    return {
        "path": path,
        "folder": path.split("/")[0],
        "title": title,
        "aliases": [title],
        "status": None,
        "body": body,
    }


NOTES = [
    _note("knowledge/statistics/markov-chain.md", "Markov Chain", MARKOV),
    _note("knowledge/nlp/n-gram.md", "N-gram Language Model", "A word model.\n"),
    _note("knowledge/nlp/tokenisation.md", "Tokenisation", "Tokenisation splits text.\n"),
    _note("wikis/statistics/index.md", "Statistics", "Portal for [[Markov Chain]].\n"),
    _note("projects/thing.md", "Thing", "Not study material.\n"),
]
# The rotation is sorted paths of knowledge/ + wikis/ minus index pages:
# [n-gram, tokenisation, markov-chain]; a day whose ordinal % 3 == 2 picks Markov.
MARKOV_DAY = next(
    date.fromordinal(o) for o in range(date(2026, 10, 1).toordinal(), 10**6) if o % 3 == 2
)


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    second_brain_store.configure(str(tmp_path / "sb.db"))
    second_brain_store.replace_all({}, NOTES)
    monkeypatch.setattr(main.settings, "dashboard_read_token", "read")
    monkeypatch.setattr(main.settings, "dashboard_write_token", "write")


def _request(method, url, headers, **kwargs):
    async def run():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, url, headers=headers, **kwargs)

    return asyncio.run(run())


def test_rotation_skips_index_pages_and_non_study_folders():
    paths = second_brain_store.paths()
    picks = {learning.pick(paths, date.fromordinal(o)) for o in range(1, 10)}
    assert picks == {n["path"] for n in NOTES[:3]}
    assert learning.pick(["projects/x.md"], date.today()) is None


def test_module_reading_questions_and_exercises():
    m = learning.module_for(MARKOV_DAY)
    assert m["path"] == "knowledge/statistics/markov-chain.md"
    headings = [r["heading"] for r in m["reading"]]
    assert headings == ["Definition", "How It Works", "Related Concepts"]
    assert "[S:" not in m["reading"][0]["markdown"]

    cloze = [q for q in m["questions"] if q["kind"] == "cloze"]
    assert cloze[0] == {
        "kind": "cloze",
        "prompt": "A _____ predicts the next state from the current state only.",
        "answer": "Markov chain",
    }
    assert all("[S:" not in q["prompt"] and "[[" not in q["prompt"] for q in cloze)

    relation = [q for q in m["questions"] if q["kind"] == "relation"]
    assert [q["prompt"] for q in relation] == [
        "How does N-gram Language Model relate to Markov Chain?",
        "How does Tokenisation relate to Markov Chain?",
    ]  # the Sources line ([[textbook]]) is not a relation question
    assert relation[0]["answer"] == "the Markov chain applied to word sequences."

    kinds = [e["kind"] for e in m["exercises"]]
    assert kinds == ["match", "explain", "investigate", "reflect"]  # My Understanding is empty
    match = m["exercises"][0]
    assert sorted(match["options"]) == match["options"]
    # The backlinking portal page is not a match term, and no summary names its own note.
    assert {p["term"] for p in match["pairs"]} == {"N-gram Language Model", "Tokenisation"}
    assert "_____ splits text." in match["options"]
    assert m["exercises"][2]["prompt"] == "How does smoothing handle zero-count bigrams?"


def test_endpoints_require_tokens_and_record_progress_for_the_days_pick_only():
    day = MARKOV_DAY.isoformat()
    url = f"/api/v1/learning/module?day={day}"
    read_only = {"X-Dashboard-Token": "read"}
    write = {"X-Dashboard-Write-Token": "write"}
    progress = "/api/v1/learning/progress"
    assert _request("GET", url, {"X-Dashboard-Token": "bad"}).status_code == 401
    module = _request("GET", url, read_only).json()
    assert module["completed_at"] is None

    post = {"day": day, "path": module["path"]}
    assert _request("POST", progress, read_only, json=post).status_code == 401
    wrong = {**post, "path": "knowledge/nlp/n-gram.md"}
    assert _request("POST", progress, write, json=wrong).status_code == 422
    done = _request("POST", progress, write, json=post).json()["completed_at"]
    again = _request("POST", progress, write, json=post).json()["completed_at"]
    assert done == again  # idempotent: the first completion time is kept
    assert _request("GET", url, read_only).json()["completed_at"] == done

    # A resync keeps progress.
    second_brain_store.replace_all({}, NOTES)
    assert _request("GET", url, read_only).json()["completed_at"] == done


def test_no_notes_is_404():
    second_brain_store.replace_all({}, [])
    r = _request("GET", "/api/v1/learning/module", {"X-Dashboard-Token": "read"})
    assert r.status_code == 404
