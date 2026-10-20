"""Daily digest: a pure renderer plus an exactly-once-per-local-day runner.

The scheduler (cron-job.org, 08:00 America/Chicago) only calls the endpoint; this
module decides whether to send. It sends when the Chicago local time is 8:00 or
later and no digest was sent for that local date, so a late or retried call still
delivers once and an early call (or DST drift) is a no-op.
"""

from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from . import personal_news, personal_shoes, personal_sports, personal_store

TZ = ZoneInfo("America/Chicago")
SEND_HOUR = 8
MAX_ITEMS = 12
PER_TOPIC = 2


def local_date(now: datetime) -> str:
    """The idempotency key: the America/Chicago calendar date."""
    return now.astimezone(TZ).date().isoformat()


def _fmt(value: str) -> str:
    return datetime.fromisoformat(value).astimezone(TZ).strftime("%Y/%m/%d %H:%M:%S")


def _age(value: Optional[str], now: datetime) -> str:
    if not value:
        return ""
    hours = max((now - datetime.fromisoformat(value)).total_seconds() / 3600, 0)
    return f"{int(hours)}h ago" if hours < 48 else f"{round(hours / 24)}d ago"


def _game_line(g: dict) -> str:
    score = ""
    if g["home_score"] is not None and g["away_score"] is not None:
        score = f" {g['away_score']}-{g['home_score']}"
    return f"{g['away']} at {g['home']}{score} ({g['status']}, {_fmt(g['start_at'])})"


def _shoe_line(x: dict) -> str:
    price = f"${x['price']:.2f}" if x["price"] is not None else "price n/a"
    if x.get("prev_price") is not None:
        was = f" (was ${x['prev_price']:.2f})"
    else:
        was = " (new)" if x.get("sightings", 1) == 1 else ""
    return f"{x['title']} - {price}{was}"


# Email HTML: tables + inline styles only, so Gmail/Outlook render it. Inline colours are the
# light theme; the <style> block swaps in the dashboard's dark tokens where the client honours
# prefers-color-scheme (Apple Mail, iOS, Outlook.com). Gmail apps apply their own dark inversion.
_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
BG, CARD, LINE = "#f4f4f5", "#ffffff", "#e4e4e7"
INK, MUTED, ACCENT = "#18181b", "#71717a", "#2563eb"
_DARK_CSS = (
    ":root{color-scheme:light dark}"
    "@media (prefers-color-scheme: dark){"
    ".d-bg{background:#09090b!important}"
    ".d-card{background:#141416!important;border-color:#27272a!important}"
    ".d-rule{border-color:#27272a!important}"
    ".d-ink{color:#fafafa!important}.d-muted{color:#a1a1aa!important}"
    ".d-accent{color:#818cf8!important}}"
)
_TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _eyebrow(text: str, accent: bool = False) -> str:
    color, cls = (ACCENT, "d-accent") if accent else (MUTED, "d-muted")
    return (
        f'<div class="{cls}" style="color:{color};font-size:11px;font-weight:600;'
        f'letter-spacing:0.08em;text-transform:uppercase">{_e(text)}</div>'
    )


def _link(label: str, url: str, size: int = 15) -> str:
    return (
        f'<a class="d-ink" href="{_e(url)}" style="color:{INK};font-size:{size}px;'
        f'font-weight:600;line-height:1.35;text-decoration:none">{_e(label)}</a>'
    )


def _text(text: str) -> str:
    return f'<div class="d-ink" style="color:{INK};font-size:15px">{_e(text)}</div>'


def _meta(text: str) -> str:
    style = f"color:{MUTED};font-size:13px;margin-top:4px"
    return f'<div class="d-muted" style="{style}">{_e(text)}</div>'


def _card(inner: str) -> str:
    return (
        f'<tr><td style="padding:0 0 16px"><table {_TABLE} class="d-card" '
        f'style="background:{CARD};border:1px solid {LINE};border-radius:8px">'
        f'<tr><td style="padding:20px 24px">{inner}</td></tr></table></td></tr>'
    )


def _list_card(title: str, rows: list[str]) -> str:
    """A titled card of rows separated by hairlines."""
    cells = []
    for i, row in enumerate(rows):
        border = f"border-top:1px solid {LINE};" if i else ""
        bottom = 0 if i == len(rows) - 1 else 12
        style = f"{border}padding:12px 0 {bottom}px"
        cells.append(f'<tr><td class="d-rule" style="{style}">{row}</td></tr>')
    return _card(_eyebrow(title, accent=True) + f'<table {_TABLE}>{"".join(cells)}</table>')


def _item_meta(item: dict, now: datetime) -> str:
    return " · ".join(x for x in (item["source"], _age(item.get("published_at"), now)) if x)


def _brief_sections(brief: Optional[dict]) -> list[tuple[str, list[tuple[str, str]]]]:
    """(title, [(label, url)]) for the assistant brief's calendar, projects and gym."""
    if not brief:
        return []
    out = []
    events = brief["calendar"]["events"]
    out.append(("Today", [
        (e["title"] if e["all_day"] else
         f"{datetime.fromisoformat(e['start']).strftime('%I:%M %p').lstrip('0')} {e['title']}", "")
        for e in events
    ]))
    out.append(("Projects that need you", [
        (f"{p['folder']}: {'; '.join(p['reasons'])}"
         + (f" (left off: {p['note']['text'].splitlines()[0]})" if p["note"] else ""), "")
        for p in brief["projects"]["projects"] if p["reasons"]
    ]))
    gym = brief["gym"]
    day = ((gym.get("data") or {}).get("next_gym_day") or {}).get("name")
    if gym.get("app_url"):
        out.append(("Gym", [(f"Next: {day}" if day else "Log today's workout", gym["app_url"])]))
    return out


def render(
    items: list[dict], freshness: Optional[str], now: datetime,
    games: Optional[list[dict]] = None, shoes: Optional[list[dict]] = None,
    brief: Optional[dict] = None,
) -> tuple[str, str, str]:
    """Return (subject, plaintext, html). Pure: no I/O.

    Editorial layout: the first pick (saved first, then top score) is the lead story,
    then games and shoe changes, then the remaining picks grouped by topic.
    """
    local = now.astimezone(TZ)
    subject = f"AIsaac digest — {local:%a %Y/%m/%d}"
    fresh = (
        f"News as of {_fmt(freshness)} {datetime.fromisoformat(freshness).astimezone(TZ):%Z}"
        if freshness else "News freshness unknown (no successful refresh yet)"
    )
    games, shoes = games or [], shoes or []
    lead, rest = (items[0], items[1:]) if items else (None, [])
    by_topic: dict[str, list[dict]] = {}
    for item in rest:
        by_topic.setdefault(item["topic"], []).append(item)

    lines, cards = [subject], []

    def section(title: str, text_rows: list[tuple[str, str]], card: str) -> None:
        if text_rows:
            lines.extend(["", title] + [
                f"- {label}" + (f"\n  {url}" if url else "") for label, url in text_rows
            ])
            cards.append(card)

    for title, rows in _brief_sections(brief):
        section(title, rows, _list_card(title, [
            _link(label, url) if url else _text(label) for label, url in rows
        ]))

    if lead:
        section(
            f"Lead story [{lead['topic']}]",
            [(f"{lead['title']} ({lead['source']})", lead["url"])],
            _card(
                _eyebrow(f"Lead story · {lead['topic']}", accent=True)
                + f'<div style="margin-top:8px">{_link(lead["title"], lead["url"], 22)}</div>'
                + _meta(_item_meta(lead, now))
                + (_meta(lead["why"]) if lead.get("why") else "")
            ),
        )
    section("Games", [(_game_line(g), g["url"]) for g in games],
            _list_card("Games", [_link(_game_line(g), g["url"]) for g in games]))
    section("Shoe watches", [(_shoe_line(x), x["url"]) for x in shoes],
            _list_card("Shoe watches", [_link(_shoe_line(x), x["url"]) for x in shoes]))
    for topic, group in by_topic.items():
        section(
            topic.title(),
            [(f"{i['title']} ({i['source']})", i["url"]) for i in group],
            _list_card(topic, [_link(i["title"], i["url"]) + _meta(_item_meta(i, now))
                               for i in group]),
        )
    if not items:
        lines += ["", "No new reading picks."]
        cards.append(_card(_meta("No new reading picks today.")))
    lines += ["", fresh]

    counts = " · ".join(
        f"{n} {label}{'' if n == 1 else 's'}"
        for n, label in (
            (len(items), "reading pick"), (len(games), "game"), (len(shoes), "shoe update")
        )
        if n
    )
    masthead = (
        f'<tr><td style="padding:4px 4px 20px">{_eyebrow("AIsaac Daily", accent=True)}'
        f'<div class="d-ink" style="color:{INK};font-size:28px;font-weight:700;'
        f'letter-spacing:-0.02em;margin-top:6px">{local:%A}, {local:%Y/%m/%d}</div>'
        + (_meta(counts) if counts else "") + "</td></tr>"
    )
    footer = (
        f'<tr><td class="d-muted" style="color:{MUTED};font-size:12px;padding:4px 4px 0">'
        f"{_e(fresh)}. Headlines link to the publisher.</td></tr>"
    )
    body = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        f"<title>{_e(subject)}</title><style>{_DARK_CSS}</style></head>"
        f'<body class="d-bg" style="margin:0;padding:0;background:{BG}">'
        f'<table {_TABLE} class="d-bg" style="background:{BG}"><tr>'
        f'<td align="center" style="padding:24px 12px;font-family:{_FONT}">'
        f'<table {_TABLE} style="max-width:600px;font-family:{_FONT}">'
        + masthead + "".join(cards) + footer
        + "</table></td></tr></table></body></html>"
    )
    return subject, "\n".join(lines) + "\n", body


def pick_games(now: datetime) -> list[dict]:
    """Priority-team games plus today's Top-25 college games (only while rankings are current)."""
    games = personal_sports.priority_events(now)
    if personal_sports.rankings_status(now)["current"]:
        lo = (now - timedelta(days=1)).isoformat()
        hi = (now + timedelta(days=1)).isoformat()
        seen = {g["id"] for g in games}
        games += [g for g in personal_store.list_events(top_25_only=True, date_from=lo, date_to=hi)
                  if g["id"] not in seen]
    return games[:MAX_ITEMS]


def pick_items() -> list[dict]:
    """Saved items first, then top-scored new ones, at most PER_TOPIC per topic for variety."""
    candidates = personal_store.list_items(state="saved", limit=200) + personal_store.list_items(
        state="new", limit=200
    )
    counts: dict[str, int] = {}
    picked = []
    for item in candidates:
        if counts.get(item["topic"], 0) < PER_TOPIC:
            counts[item["topic"]] = counts.get(item["topic"], 0) + 1
            picked.append(item)
    return picked[:MAX_ITEMS]


def run(
    now: Optional[datetime] = None,
    *,
    dry_run: bool = False,
    send: Callable[[str, str, str], bool],
    refresh: Callable[[], None] = personal_news.refresh,
    brief: Optional[dict] = None,
    push: Optional[Callable[[], bool]] = None,
) -> dict:
    """Refresh, render and (unless dry_run) send once for today's Chicago date."""
    now = now or datetime.now(timezone.utc)
    key = local_date(now)
    if dry_run:
        subject, text, _ = render(
            pick_items(), personal_store.freshness_at(), now,
            pick_games(now), personal_shoes.recent_changes(now), brief=brief,
        )
        return {"status": "dry_run", "local_date": key, "subject": subject, "text": text}
    if now.astimezone(TZ).hour < SEND_HOUR:
        return {"status": "too_early", "local_date": key}
    if not personal_store.claim_run(key):
        return {"status": "already_handled", "local_date": key}

    try:
        refresh()  # best effort: per-feed errors are isolated and the last snapshot is kept
        personal_sports.refresh()
        personal_shoes.refresh()
        freshness = personal_store.freshness_at()
        subject, text, body = render(
            pick_items(), freshness, now, pick_games(now), personal_shoes.recent_changes(now),
            brief=brief,
        )
        ok = send(subject, text, body)
        if push:
            push()  # phone summary; independent of whether the email went out
    except Exception:  # release the slot so a retry can run; never leak details
        personal_store.finish_run(key, "failed", error="send_error")
        raise
    if ok:
        personal_store.finish_run(key, "sent", freshness)
        return {"status": "sent", "local_date": key}
    personal_store.finish_run(key, "skipped", freshness, "email_not_sent")
    return {"status": "skipped", "local_date": key}
