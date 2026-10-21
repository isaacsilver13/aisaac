"""Daily philosophy practice: one passage a day, a morning intention and an evening reflection.

Deterministic rotation by America/Chicago date (like learning.py), no LLM. data/philosophy.json
alternates stoic/existentialist entries and has an even length, so consecutive days always
alternate schools. Quoted passages come from public-domain translations; Sartre, Camus and
de Beauvoir entries are paraphrases (`paraphrase: true`).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from . import daily_pushes

ENTRIES: list[dict] = json.loads(
    (Path(__file__).parent / "data" / "philosophy.json").read_text(encoding="utf-8")
)
PUSH_PASSAGE_CHARS = 280


def entry_for(day: date) -> dict:
    # ponytail: adding entries shifts the rotation; pin a start date if that bothers.
    return ENTRIES[day.toordinal() % len(ENTRIES)]


def morning_push(day: date) -> str:
    e = entry_for(day)
    passage = e["passage"]
    if len(passage) > PUSH_PASSAGE_CHARS:
        passage = passage[:PUSH_PASSAGE_CHARS].rsplit(" ", 1)[0] + "…"
    return f"{e['author']}: {passage} — {e['morning_prompt']}"


daily_pushes.PUSHES["philosophy_morning"] = (7, morning_push)
daily_pushes.PUSHES["philosophy_evening"] = (21, lambda day: entry_for(day)["evening_question"])
