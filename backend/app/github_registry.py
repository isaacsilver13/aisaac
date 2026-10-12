import re
from datetime import datetime
from typing import Any, Optional

from .schemas import RepoDefinition

GITHUB_OWNER = "isaacsilver13"

# Curated names/categories. Every other non-archived repo GITHUB_OWNER owns is discovered
# from GitHub at refresh time, so this list no longer limits what is shown.
_REPOS: tuple[RepoDefinition, ...] = (
    RepoDefinition(
        id="vinyl",
        name="Vinyl Catalog",
        category="Collection",
        owner="isaacsilver13",
        repo="vinyl",
    ),
    RepoDefinition(
        id="nfl-confidence",
        name="NFL Confidence",
        category="Sports",
        owner="isaacsilver13",
        repo="NFL_Confidence",
    ),
    RepoDefinition(
        id="betting-aggregator",
        name="Betting Aggregator",
        category="Sports",
        owner="isaacsilver13",
        repo="betting_aggregator",
    ),
    RepoDefinition(
        id="nba-prediction",
        name="NBA Prediction",
        category="Research",
        owner="isaacsilver13",
        repo="nba_prediction",
    ),
    RepoDefinition(
        id="gym-tracker",
        name="Gym Tracker",
        category="Health",
        owner="isaacsilver13",
        repo="gym_tracker",
    ),
    RepoDefinition(
        id="portfolio-analysis",
        name="Portfolio Analysis",
        category="Finance",
        owner="isaacsilver13",
        repo="portfolio_analysis",
    ),
    RepoDefinition(
        id="aisaac-dashboard",
        name="AIsaac Dashboard",
        category="Ops",
        owner="isaacsilver13",
        repo="aisaac_dashboard",
    ),
    RepoDefinition(
        id="chess",
        name="Chess",
        category="Games",
        owner="isaacsilver13",
        repo="chess",
    ),
    RepoDefinition(
        id="nba-teammates-chain",
        name="NBA Teammates Chain",
        category="Games",
        owner="isaacsilver13",
        repo="nba_teammates_chain",
    ),
)


def get_repos() -> tuple[RepoDefinition, ...]:
    return _REPOS


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "repo"


def merge_discovered(
    curated: tuple[RepoDefinition, ...], listing: Optional[list[dict[str, Any]]]
) -> tuple[RepoDefinition, ...]:
    """Curated entries keep their id/name/category; archived repos are skipped. Falls back
    to the curated list when GitHub could not be listed."""
    if listing is None:
        return curated
    by_repo = {repo.repo.lower(): repo for repo in curated}
    merged = []
    for item in listing:
        if item.get("archived"):
            continue
        pushed_at = item.get("pushed_at")
        facts = {
            "private": bool(item.get("private")),
            "description": item.get("description"),
            "language": item.get("language"),
            "pushed_at": datetime.fromisoformat(pushed_at.replace("Z", "+00:00"))
            if pushed_at
            else None,
        }
        known = by_repo.get(item["name"].lower())
        if known is not None:
            merged.append(known.model_copy(update=facts))
        else:
            merged.append(
                RepoDefinition(
                    id=_slug(item["name"]),
                    name=item["name"],
                    category="Other",
                    owner=item["owner"]["login"],
                    repo=item["name"],
                    **facts,
                )
            )
    return tuple(merged)
