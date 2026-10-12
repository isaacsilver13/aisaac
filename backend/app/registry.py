from collections.abc import Mapping

from .schemas import AppDefinition, AppStack, StackNode

NFL_METRICS = ("last_activity_at", "data_freshness_at", "picks_total", "games_total")
# Dates and counts only: no dollar amounts, tickers, accounts or P&L (see CLAUDE.md).
PORTFOLIO_METRICS = ("last_transaction_date", "transactions_total", "imports_total")

_REGISTRY: Mapping[str, tuple[AppDefinition, ...]] = {
    "local": (
        AppDefinition(
            id="vinyl",
            name="Vinyl Catalog",
            category="Collection",
            description="Record collection and wantlist management.",
            product_url="http://127.0.0.1:8501",
            health_url="http://127.0.0.1:8003/health",
        ),
        AppDefinition(
            id="nfl-confidence",
            name="NFL Confidence",
            category="Sports",
            description="Weekly NFL confidence picks and league standings.",
            product_url="http://127.0.0.1:5173",
            health_url="http://127.0.0.1:8001/api/v1/health",
            readiness_url="http://127.0.0.1:8001/api/v1/health/ready",
            metrics_url="http://127.0.0.1:8001/api/v1/health/metrics",
            metric_allowlist=NFL_METRICS,
        ),
        AppDefinition(
            id="betting-aggregator",
            name="Betting Aggregator",
            category="Sports",
            description="Odds comparison across supported sports and providers.",
            product_url="http://127.0.0.1:5174",
            health_url="http://127.0.0.1:8002/api/v1/health",
            metrics_url="http://127.0.0.1:8002/api/v1/status",
            metric_allowlist=(
                "provider",
                "provider_status",
                "data_stale",
                "event_count",
                "generated_at",
            ),
        ),
        AppDefinition(
            id="nba-prediction",
            name="NBA Prediction",
            category="Research",
            description="NBA prediction experiments, backtests, and model diagnostics.",
            product_url="http://127.0.0.1:8502",
            monitor_target="push",
        ),
        AppDefinition(
            id="gym-tracker",
            name="Gym Tracker",
            category="Health",
            description="Workout routine builder and progress tracker.",
            product_url="http://127.0.0.1:5175",
            health_url="http://127.0.0.1:8004/api/v1/health",
            readiness_url="http://127.0.0.1:8004/api/v1/health/ready",
            metrics_url="http://127.0.0.1:8004/api/v1/health/metrics",
            metric_allowlist=("last_activity_at", "sessions_logged_total"),
        ),
        AppDefinition(
            id="portfolio-analysis",
            name="Portfolio Analysis",
            category="Finance",
            description="Personal brokerage portfolio import, P&L, and SPY-alpha analysis.",
            product_url="http://127.0.0.1:5176",
            health_url="http://127.0.0.1:8005/api/v1/health",
            readiness_url="http://127.0.0.1:8005/api/v1/health/ready",
            metrics_url="http://127.0.0.1:8005/api/v1/health/metrics",
            metric_allowlist=PORTFOLIO_METRICS,
            metrics_token_setting="portfolio_metrics_token",
        ),
        AppDefinition(
            id="aisaac-rocket",
            name="AIsaac Rocket",
            category="Finance",
            description="Private personal-finance app: spending, budgets and recurring bills.",
            product_url="http://127.0.0.1:5177",
            health_url="http://127.0.0.1:8006/api/v1/health",
        ),
        AppDefinition(
            id="chess",
            name="Chess",
            category="Games",
            description="Play Stockfish bots, with post-game review and progress tracking.",
            product_url="http://127.0.0.1:5173",
            health_url="http://127.0.0.1:3000/api/health",
        ),
        AppDefinition(
            id="nba-teammates-chain",
            name="NBA Teammates Chain",
            category="Games",
            description="Daily NBA teammate-chain puzzle with shareable challenges.",
            product_url="http://127.0.0.1:5178",
            health_url="http://127.0.0.1:8007/api/v1/health",
            readiness_url="http://127.0.0.1:8007/api/v1/health/ready",
        ),
    ),
    "production": (
        AppDefinition(
            id="vinyl",
            fly_app="vinyl-catalog",
            cost_aliases=("vinyl-api",),
            name="Vinyl Catalog",
            category="Collection",
            description="Record collection and wantlist management.",
            product_url="https://vinyl-catalog.fly.dev/",
            health_url="https://vinyl-api.fly.dev/health",
            readiness_url="https://vinyl-api.fly.dev/health/ready",
            metrics_url="https://vinyl-api.fly.dev/health/metrics",
            metric_allowlist=(
                "last_activity_at",
                "data_freshness_at",
                "listing_count",
                "play_count",
            ),
        ),
        AppDefinition(
            id="nfl-confidence",
            fly_app="nfl-confidence-web",
            cost_aliases=("nfl-confidence-web-dev",),
            name="NFL Confidence",
            category="Sports",
            description="Weekly NFL confidence picks and league standings.",
            product_url="https://nfl-confidence-web.fly.dev/",
            health_url="https://nfl-confidence-web.fly.dev/api/v1/health",
            readiness_url="https://nfl-confidence-web.fly.dev/api/v1/health/ready",
            metrics_url="https://nfl-confidence-web.fly.dev/api/v1/health/metrics",
            metric_allowlist=NFL_METRICS,
        ),
        AppDefinition(
            id="betting-aggregator",
            fly_app="betting-aggregator-api",
            name="Betting Aggregator",
            category="Sports",
            description="Odds comparison across supported sports and providers.",
            product_url="https://betting-aggregator-api.fly.dev/",
            health_url="https://betting-aggregator-api.fly.dev/api/v1/health",
            metrics_url="https://betting-aggregator-api.fly.dev/api/v1/health/metrics",
            metric_allowlist=(
                "last_activity_at",
                "data_freshness_at",
                "event_count",
                "cache_hit",
            ),
        ),
        AppDefinition(
            id="nba-prediction",
            name="NBA Prediction",
            category="Research",
            description="NBA prediction experiments, backtests, and model diagnostics.",
            product_url=None,
            monitor_target="push",
        ),
        AppDefinition(
            id="gym-tracker",
            fly_app="isilver-gym-tracker-api",
            name="Gym Tracker",
            category="Health",
            description="Workout routine builder and progress tracker.",
            product_url="https://isilver-gym-tracker-api.fly.dev/",
            health_url="https://isilver-gym-tracker-api.fly.dev/api/v1/health",
            readiness_url="https://isilver-gym-tracker-api.fly.dev/api/v1/health/ready",
            metrics_url="https://isilver-gym-tracker-api.fly.dev/api/v1/health/metrics",
            metric_allowlist=("last_activity_at", "sessions_logged_total"),
        ),
        AppDefinition(
            id="portfolio-analysis",
            fly_app="portfolio-analysis-api",
            name="Portfolio Analysis",
            category="Finance",
            description="Personal brokerage portfolio import, P&L, and SPY-alpha analysis.",
            product_url="https://portfolio-analysis-api.fly.dev/",
            health_url="https://portfolio-analysis-api.fly.dev/api/v1/health",
            readiness_url="https://portfolio-analysis-api.fly.dev/api/v1/health/ready",
            metrics_url="https://portfolio-analysis-api.fly.dev/api/v1/health/metrics",
            metric_allowlist=PORTFOLIO_METRICS,
            metrics_token_setting="portfolio_metrics_token",
        ),
        AppDefinition(
            id="aisaac-rocket",
            fly_app="aisaac-rocket",
            name="AIsaac Rocket",
            category="Finance",
            description="Private personal-finance app: spending, budgets and recurring bills.",
            product_url="https://aisaac-rocket.fly.dev/",
            health_url="https://aisaac-rocket.fly.dev/api/v1/health",
        ),
        AppDefinition(
            id="chess",
            fly_app="aisaac-chess",
            name="Chess",
            category="Games",
            description="Play Stockfish bots, with post-game review and progress tracking.",
            product_url="https://aisaac-chess.fly.dev/",
            health_url="https://aisaac-chess.fly.dev/api/health",
        ),
        AppDefinition(
            id="nba-teammates-chain",
            fly_app="nba-teammates-chain-api",
            name="NBA Teammates Chain",
            category="Games",
            description="Daily NBA teammate-chain puzzle with shareable challenges.",
            product_url="https://nba-teammates-chain-api.fly.dev/",
            health_url="https://nba-teammates-chain-api.fly.dev/api/v1/health",
            readiness_url="https://nba-teammates-chain-api.fly.dev/api/v1/health/ready",
        ),
    ),
}


def _node(kind: str, name: str, tech: str, host: str | None = None, detail: str = "") -> StackNode:
    return StackNode(kind=kind, name=name, tech=tech, host=host, detail=detail)


_PUBLIC_PROBES = "Public health, readiness and allowlisted metrics checks"

# Topology for the Stack tab, shared by both profiles. Versions and regions are copied
# from each repo's manifests and fly.toml (2026-10); the live Fly release comes from
# the Deployments API. ponytail: hand-maintained, refresh when an app upgrades a major.
STACKS: Mapping[str, AppStack] = {
    "vinyl": AppStack(
        description="Catalog UI and API are separate Fly apps; the API owns the collection data.",
        region="ewr",
        nodes=(
            _node("ui", "Catalog UI", "Streamlit 1.63", "vinyl-catalog"),
            _node("api", "Vinyl API", "FastAPI 0.141 · SQLAlchemy 2.0", "vinyl-api"),
            _node("database", "Collection DB", "SQLite", "vinyl-api", "Fly volume /data"),
        ),
        monitoring=_PUBLIC_PROBES,
    ),
    "nfl-confidence": AppStack(
        description="One Fly app serves the React UI and the FastAPI endpoints.",
        region="iad",
        nodes=(
            _node("ui", "Web experience", "React 19 · Vite 8", "nfl-confidence-web"),
            _node("api", "Picks API", "FastAPI 0.115 · SQLAlchemy 2.0", "nfl-confidence-web"),
            _node("database", "Application data", "PostgreSQL", None, "psycopg 3"),
        ),
        monitoring=_PUBLIC_PROBES,
    ),
    "betting-aggregator": AppStack(
        description="One Fly app serves UI and API; the API merges provider odds with its DB.",
        region="ewr",
        nodes=(
            _node("ui", "Odds comparison", "React 18 · Vite 6", "betting-aggregator-api"),
            _node(
                "api", "Aggregator API", "FastAPI 0.115 · SQLAlchemy 2.0", "betting-aggregator-api"
            ),
            _node("database", "Odds + cache state", "PostgreSQL", "Neon", "asyncpg"),
            _node("provider", "Odds provider", "The Odds API", None, "External HTTP API"),
        ),
        monitoring="Public health and allowlisted metrics checks",
    ),
    "nba-prediction": AppStack(
        description="Intentionally local-only: no production endpoint; it pushes a heartbeat.",
        nodes=(
            _node("ui", "Dashboard", "Streamlit 1.65", "Local machine"),
            _node("job", "Experiments", "Python · models + backtests", "Local machine"),
            _node("database", "Datasets + artifacts", "Local files", "Local machine"),
        ),
        monitoring="Push heartbeat only; no public health probe",
    ),
    "gym-tracker": AppStack(
        description="One Fly app serves the workout UI and its API.",
        region="ewr",
        nodes=(
            _node("ui", "Workout interface", "React 18 · Vite 6", "isilver-gym-tracker-api"),
            _node("api", "Gym API", "FastAPI 0.115 · SQLAlchemy 2.0", "isilver-gym-tracker-api"),
            _node("database", "Application data", "PostgreSQL", None, "psycopg 3"),
        ),
        monitoring=_PUBLIC_PROBES,
    ),
    "portfolio-analysis": AppStack(
        description="Owns private portfolio data; AIsaac reads only scoped aggregate metrics.",
        region="iad",
        nodes=(
            _node("ui", "Portfolio interface", "React 19 · Vite 8", "portfolio-analysis-api"),
            _node(
                "api", "Portfolio API", "FastAPI 0.115 · SQLAlchemy 2.0", "portfolio-analysis-api"
            ),
            _node("database", "Private portfolio data", "PostgreSQL", None, "Not read by AIsaac"),
        ),
        monitoring="Health, readiness and scoped aggregate metrics checks",
    ),
    "aisaac-rocket": AppStack(
        description="One Fly app serves the finance UI and API; AIsaac probes public health only.",
        region="iad",
        nodes=(
            _node("ui", "Finance interface", "React 18 · Vite 6", "aisaac-rocket"),
            _node("api", "Finance API", "FastAPI 0.115 · SQLAlchemy 2.1", "aisaac-rocket"),
            _node(
                "database",
                "Private finance data",
                "SQLite",
                "aisaac-rocket",
                "Fly volume /data · not read by AIsaac",
            ),
        ),
        monitoring="Public health check only; no metrics exposed",
    ),
    "chess": AppStack(
        description="One Fly app serves the board UI and API; AIsaac probes public health only.",
        region="ewr",
        nodes=(
            _node("ui", "Board + Stockfish bots", "React 19 · Vite 8", "aisaac-chess"),
            _node("api", "Game server", "Hono 4 · Node", "aisaac-chess"),
            _node(
                "database",
                "Game history",
                "SQLite · better-sqlite3",
                "aisaac-chess",
                "Fly volume /data · not read by AIsaac",
            ),
        ),
        monitoring="Public health check only; no metrics exposed",
    ),
    "nba-teammates-chain": AppStack(
        description="One Fly app serves the game UI and API; AIsaac probes health and readiness.",
        region="ewr",
        nodes=(
            _node("ui", "Chain game", "React 18 · Vite 6", "nba-teammates-chain-api"),
            _node(
                "api", "Game API", "FastAPI · SQLAlchemy 2.0", "nba-teammates-chain-api"
            ),
            _node(
                "database",
                "Players + teammate graph",
                "PostgreSQL",
                "Neon",
                "psycopg 3 · loaded into memory at startup",
            ),
        ),
        monitoring="Public health and readiness checks; no metrics exposed",
    ),
}


def get_registry(profile: str) -> tuple[AppDefinition, ...]:
    try:
        return _REGISTRY[profile]
    except KeyError as error:
        raise ValueError(f"Unknown profile: {profile}") from error
