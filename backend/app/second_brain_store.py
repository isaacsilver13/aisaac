"""Second-brain vault notes pushed by scripts/second_brain_push.py.

Same SQLite-on-a-Fly-volume pattern as metrics_store.py. Each sync replaces the
whole set (the vault is the source of truth), so deletions propagate. Wikilinks are
resolved once, at sync time, into a `links` table and a per-note `link_map`. Reads never
touch the filesystem: a path is only ever looked up as a key.
"""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    path TEXT PRIMARY KEY, folder TEXT NOT NULL, title TEXT NOT NULL,
    aliases TEXT NOT NULL, status TEXT, body TEXT NOT NULL,
    frontmatter TEXT NOT NULL DEFAULT '{}', link_map TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS links (
    src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst)
);
-- Daily-learning completions; sync never clears this table.
CREATE TABLE IF NOT EXISTS learning_progress (
    day TEXT NOT NULL, path TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY (day, path)
);
CREATE TABLE IF NOT EXISTS meta (
    id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, pushed_at TEXT NOT NULL
);
"""
_NEW_COLUMNS = (("frontmatter", "'{}'"), ("link_map", "'{}'"))
_WIKILINK = re.compile(r"\[\[([^\]|#]+)")
_INLINE_LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
_PRIORITY = {"wikis": 0, "knowledge": 1, "projects": 2, "questions": 3}

_db_path: str = "./aisaac_second_brain.db"


def configure(db_path: str) -> None:
    global _db_path
    _db_path = db_path
    with _connect() as conn:
        conn.executescript(_SCHEMA)
        # Existing prod volumes hold the old notes table; add columns until the next sync.
        have = {r["name"] for r in conn.execute("PRAGMA table_info(notes)")}
        for col, default in _NEW_COLUMNS:
            if col not in have:
                conn.execute(f"ALTER TABLE notes ADD COLUMN {col} TEXT NOT NULL DEFAULT {default}")


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def portal_of(path: str) -> str:
    """`wikis/apps/x.md` -> `wikis/apps`, `knowledge/ai/x.md` -> `knowledge/ai`, else the folder."""
    parts = path.split("/")
    nested = parts[0] in ("wikis", "knowledge") and len(parts) > 2
    return "/".join(parts[:2]) if nested else parts[0]


def _name_map(notes: list[dict]) -> dict[str, str]:
    names: dict[str, str] = {}
    for n in sorted(notes, key=lambda n: _PRIORITY.get(n["folder"], 9)):
        stem = n["path"].rsplit("/", 1)[-1].removesuffix(".md")
        for name in (stem, n["title"], *n["aliases"]):
            names.setdefault(name.strip().lower(), n["path"])
    return names


def _preview(body: str, limit: int = 200) -> str:
    for para in body.split("\n\n"):
        p = para.strip()
        if p and not p.startswith(("#", "|", "-", ">", "*", "```", "1.")):
            flat = _INLINE_LINK.sub(lambda m: m.group(2) or m.group(1), p)
            return " ".join(flat.split())[:limit]
    return ""


def replace_all(meta: dict, notes: list[dict]) -> None:
    names = _name_map(notes)
    rows, edges = [], set()
    for n in notes:
        link_map: dict[str, Optional[str]] = {}
        for target in _WIKILINK.findall(n["body"]):
            dst = names.get(target.strip().lower())
            link_map[target.strip().lower()] = dst
            if dst and dst != n["path"]:
                edges.add((n["path"], dst))
        rows.append(
            (
                n["path"],
                n["folder"],
                n["title"],
                json.dumps(n["aliases"]),
                n["status"],
                n["body"],
                json.dumps(n.get("frontmatter", {})),
                json.dumps(link_map),
            )
        )
    with _connect() as conn:
        conn.execute("DELETE FROM notes")
        conn.execute("DELETE FROM links")
        conn.executemany(
            "INSERT INTO notes (path, folder, title, aliases, status, body, frontmatter, link_map)"
            " VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
        conn.executemany("INSERT INTO links (src, dst) VALUES (?,?)", sorted(edges))
        conn.execute(
            "INSERT INTO meta (id, payload, pushed_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, "
            "pushed_at = excluded.pushed_at",
            (json.dumps(meta), datetime.now(timezone.utc).isoformat()),
        )


def summary() -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT payload, pushed_at FROM meta WHERE id = 1").fetchone()
        if row is None:
            return None
        counts = {
            r["folder"]: r["n"]
            for r in conn.execute("SELECT folder, COUNT(*) AS n FROM notes GROUP BY folder")
        }
    return {**json.loads(row["payload"]), "counts": counts, "pushed_at": row["pushed_at"]}


def list_notes(q: str = "", folder: str = "") -> list[dict]:
    sql, args = "SELECT path, folder, title, aliases, status, frontmatter FROM notes WHERE 1=1", []
    if folder:
        sql += " AND folder = ?"
        args.append(folder)
    if q:
        sql += " AND (title LIKE ? OR aliases LIKE ? OR body LIKE ?)"
        args += [f"%{q}%"] * 3
    with _connect() as conn:
        rows = conn.execute(sql + " ORDER BY folder, title LIMIT 500", args).fetchall()
    return [
        {
            **{k: r[k] for k in ("path", "folder", "title", "status")},
            "aliases": json.loads(r["aliases"]),
            "updated": json.loads(r["frontmatter"]).get("updated"),
        }
        for r in rows
    ]


def get_note(path: str) -> Optional[dict]:
    with _connect() as conn:
        r = conn.execute("SELECT * FROM notes WHERE path = ?", (path,)).fetchone()
        if r is None:
            return None
        out_q = "SELECT dst FROM links WHERE src = ? ORDER BY dst"
        back_q = "SELECT src FROM links WHERE dst = ? ORDER BY src"
        out = [x["dst"] for x in conn.execute(out_q, (path,))]
        back = [x["src"] for x in conn.execute(back_q, (path,))]
        wanted = sorted(set(out) | set(back))
        marks = ",".join("?" * len(wanted))
        refs = {
            x["path"]: x
            for x in conn.execute(
                f"SELECT path, title, folder, body FROM notes WHERE path IN ({marks})", wanted
            )
        }

    def ref(p: str) -> dict:
        return {k: refs[p][k] for k in ("path", "title", "folder")}

    return {
        **{k: r[k] for k in ("path", "folder", "title", "status", "body")},
        "aliases": json.loads(r["aliases"]),
        "frontmatter": json.loads(r["frontmatter"]),
        "link_map": json.loads(r["link_map"]),
        "links": [ref(p) for p in out],
        "backlinks": [ref(p) for p in back],
        "previews": {p: _preview(refs[p]["body"]) for p in wanted},
        "portal": portal_of(path),
    }


def graph() -> dict:
    with _connect() as conn:
        node_q = "SELECT path, title, folder FROM notes ORDER BY path"
        edge_q = "SELECT src, dst FROM links ORDER BY src, dst"
        nodes = [dict(r) for r in conn.execute(node_q)]
        edges = [[r["src"], r["dst"]] for r in conn.execute(edge_q)]
    return {"nodes": nodes, "edges": edges}


def portals() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT path, title, body FROM notes ORDER BY path").fetchall()
    out: dict[str, dict] = {}
    for r in rows:
        pid = portal_of(r["path"])
        p = out.setdefault(
            pid,
            {
                "id": pid,
                "title": pid.rsplit("/", 1)[-1].replace("-", " ").title(),
                "count": 0,
                "index_path": None,
                "description": "",
            },
        )
        p["count"] += 1
        if r["path"] == f"{pid}/index.md":
            p.update(index_path=r["path"], title=r["title"], description=_preview(r["body"]))
    return list(out.values())


def paths() -> list[str]:
    with _connect() as conn:
        return [r["path"] for r in conn.execute("SELECT path FROM notes ORDER BY path")]


def mark_studied(day: str, path: str) -> str:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO learning_progress (day, path, completed_at) VALUES (?,?,?)",
            (day, path, now),
        )
    return studied(day, path) or now


def studied(day: str, path: str) -> Optional[str]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT completed_at FROM learning_progress WHERE day = ? AND path = ?", (day, path)
        ).fetchone()
    return row["completed_at"] if row else None
