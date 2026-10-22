"""NBA daily report pushed by bet_watch (picks, prices and percentages only).

The payload contract is bet_watch PR #11 ("Report payload"). Every model forbids extra fields,
so a stake, dollar amount or account field is rejected (422) rather than stored.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from . import daily_pushes, personal_store


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NbaGame(_Strict):
    game_id: Optional[int] = None
    home: str
    away: str
    tip: Optional[str] = None
    pred_margin: float
    p_home_win: float
    market_spread_home: Optional[float] = None
    market_home_win_prob: Optional[float] = None
    books: int = 0


class NbaPick(_Strict):
    tier: Literal["targeted", "watchlist"]
    game_id: Optional[int] = None
    home: str
    away: str
    tip: Optional[str] = None
    market: str
    side: str
    team: str
    line: Optional[float] = None
    book: str
    price_american: int
    model_prob: float
    market_prob: float
    ev: float
    kelly_frac: float


class NbaTrackRecord(_Strict):
    tier: Literal["targeted", "watchlist"]
    picks: int
    graded: int
    won: int
    lost: int
    push: int
    flat_roi: Optional[float] = None
    avg_clv: Optional[float] = None
    clv_samples: int = 0
    beat_close_pct: Optional[float] = None


class NbaReport(_Strict):
    kind: Literal["nba_daily_report"]
    slate_date: date
    generated_at: str
    model_version: str
    data_through: Optional[str] = None
    odds_as_of: Optional[str] = None
    games: list[NbaGame]
    picks: list[NbaPick]
    track_record: list[NbaTrackRecord]


def push_message(day: date) -> Optional[str]:
    report = personal_store.get_nba_report(day.isoformat())
    if report is None:
        return None  # bet_watch hasn't pushed today's report yet; retry next hour
    targeted = [p for p in report["picks"] if p["tier"] == "targeted"]
    if not targeted:
        return "No targeted bets today"
    top = max(targeted, key=lambda p: p["ev"])
    price = f"{top['price_american']:+d}"
    return (
        f"{len(targeted)} targeted bet{'s' if len(targeted) != 1 else ''} today — top: "
        f"{top['team']} {price} @ {top['book']}, EV {top['ev'] * 100:.1f}%"
    )


daily_pushes.PUSHES["nba_report"] = (10, push_message)
