"""Daily learning module built deterministically from the synced second-brain vault.

Topic selection is a fixed rotation: the eligible notes (knowledge/ and wikis/ articles,
portal index pages excluded) sorted by path, indexed by the America/Chicago date's
ordinal. Questions and exercises come from note structure only (no LLM): cloze deletions
of the note's own terms, "how does X relate" from described wikilinks, link/preview
matching, and the note's Open Questions.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

from . import second_brain_store

TZ = ZoneInfo("America/Chicago")
STUDY_FOLDERS = ("knowledge/", "wikis/")
# Sections that are bookkeeping, not reading. Related Concepts / Open Questions feed questions.
NOT_READING = {
    "sources",
    "history / change log",
    "change log",
    "my understanding",
    "open questions",
}
MAX_CLOZE, MAX_RELATION, MAX_MATCH = 5, 4, 5

_CITATION = re.compile(r"\s*\[S:[^\]]*\]")
_LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
# "- [[Target]] - what it is to this note" (also ":" / en dash / em dash separators).
_DESCRIBED_LINK = re.compile(r"^\s*[-*]\s*\[\[([^\]|#]+)[^\]]*\]\]\s*[-:–—]\s*(.+)$", re.M)
_BULLET = re.compile(r"^\s*(?:[-*]|\d+\.)\s+", re.M)


def today() -> date:
    return datetime.now(TZ).date()


def pick(paths: list[str], day: date) -> Optional[str]:
    eligible = sorted(
        p for p in paths if p.startswith(STUDY_FOLDERS) and not p.endswith("/index.md")
    )
    # ponytail: adding/removing notes shifts the rotation; pin a start date if that bothers.
    return eligible[day.toordinal() % len(eligible)] if eligible else None


def sections(body: str) -> list[tuple[str, str]]:
    """`## Heading` blocks as (heading, text); text before the first H2 is ("", text)."""
    out: list[tuple[str, str]] = []
    for i, chunk in enumerate(re.split(r"^##\s+", body, flags=re.M)):
        if i == 0:
            heading, text = "", re.sub(r"^\s*#\s+.*\n?", "", chunk, count=1)
        else:
            heading, _, text = chunk.partition("\n")
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S).strip()
        if text:
            out.append((heading.strip(), text))
    return out


def plain(text: str) -> str:
    """Strip citations, wikilink brackets and bold markers for question text."""
    text = _LINK.sub(lambda m: m.group(2) or m.group(1), _CITATION.sub("", text))
    return " ".join(_BOLD.sub(r"\1", text).split())


def sentences(text: str) -> list[str]:
    out = []
    for line in _BULLET.sub("", text).splitlines():
        out += [s.strip() for s in re.split(r"(?<=[.!?])\s+", plain(line)) if s.strip()]
    return out


def cloze(texts: list[str], terms: list[str]) -> list[dict]:
    """Blank the longest known term in each sentence that contains one (whole words only)."""
    by_length = sorted({t for t in terms if len(t) > 2}, key=len, reverse=True)
    out = []
    for s in (s for t in texts for s in sentences(t)):
        for term in by_length:
            m = re.search(rf"(?<!\w){re.escape(term)}(?!\w)", s, re.I)
            if m and len(s) > len(term) + 20:
                prompt = f"{s[: m.start()]}_____{s[m.end() :]}"
                out.append({"kind": "cloze", "prompt": prompt, "answer": m.group(0)})
                break
        if len(out) == MAX_CLOZE:
            break
    return out


def _blank(text: str, term: str) -> str:
    return re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", "_____", text, flags=re.I)


def build(note: dict, day: date) -> dict:
    title, body = note["title"], note["body"]
    by_path = {r["path"]: r for r in note["links"] + note["backlinks"]}
    secs = sections(body)
    reading = [
        {"heading": h, "markdown": _CITATION.sub("", t)}
        for h, t in secs
        if h.lower() not in NOT_READING
    ]

    terms = [title, *note["aliases"], *_BOLD.findall(body), *(r["title"] for r in by_path.values())]
    prose = [r["markdown"] for r in reading if r["heading"].lower() != "related concepts"]
    questions = cloze(prose, terms)

    relations = []
    for target, why in _DESCRIBED_LINK.findall(body):
        dst = note["link_map"].get(target.strip().lower())
        source_line = any(h.lower() == "sources" and f"[[{target}" in t for h, t in secs)
        if dst in by_path and not source_line and len(relations) < MAX_RELATION:
            relations.append(
                {
                    "kind": "relation",
                    "prompt": f"How does {by_path[dst]['title']} relate to {title}?",
                    "answer": plain(why),
                    "path": dst,
                }
            )
    questions += relations

    # Portal index pages are navigation, not concepts; a summary that names its own note is
    # blanked so the match can't be solved by reading the first word.
    concepts = {p: r for p, r in by_path.items() if not p.endswith("/index.md")}
    pairs = [
        {"path": p, "term": r["title"], "definition": _blank(note["previews"][p], r["title"])}
        for p, r in concepts.items()
        if note["previews"].get(p)
    ][:MAX_MATCH]
    exercises: list[dict] = []
    if len(pairs) >= 2:
        exercises.append(
            {
                "kind": "match",
                "prompt": "Match each linked note to its summary.",
                "pairs": pairs,
                # Deterministic shuffle: the options are listed alphabetically, not in term order.
                "options": sorted(p["definition"] for p in pairs),
            }
        )
    linked = list(concepts.values())
    if len(linked) >= 2:
        a, b = linked[0]["title"], linked[1]["title"]
        exercises.append(
            {
                "kind": "explain",
                "prompt": f"Explain the relationship between {a} and {b} via {title}.",
            }
        )
    for h, t in secs:
        if h.lower() == "open questions":
            exercises += [{"kind": "investigate", "prompt": q} for q in sentences(t)]
    if not any(h.lower() == "my understanding" for h, _ in secs):
        exercises.append(
            {
                "kind": "reflect",
                "prompt": f"Write the My Understanding section of {title} in your own words.",
            }
        )

    return {
        "date": day.isoformat(),
        "path": note["path"],
        "title": title,
        "portal": note["portal"],
        "link_map": note["link_map"],
        "reading": reading,
        "questions": questions,
        "exercises": exercises,
        "completed_at": second_brain_store.studied(day.isoformat(), note["path"]),
    }


def module_for(day: date) -> Optional[dict]:
    path = pick(second_brain_store.paths(), day)
    note = second_brain_store.get_note(path) if path else None
    return build(note, day) if note else None
