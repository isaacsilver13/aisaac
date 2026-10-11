export type HealthState = "up" | "slow" | "degraded" | "down" | "unavailable" | "stale";

export interface CheckResult {
  app_id: string;
  name: string;
  category: string;
  description: string;
  product_url: string | null;
  state: HealthState;
  checked_at: string;
  response_ms: number | null;
  http_status: number | null;
  readiness: HealthState | null;
  provider_state: string | null;
  freshness: string | null;
  page_state: HealthState | null;
  metrics_state: HealthState | null;
  metrics: Record<string, string | number | boolean>;
  detail: string | null;
  cached: boolean;
}

export interface DashboardResponse {
  profile: "local" | "production";
  refreshed_at: string;
  results: CheckResult[];
}

export interface Incident {
  id: number;
  app_id: string;
  failure_type: string;
  started_at: string;
  resolved_at: string | null;
  notes: string | null;
}

export type CiStatus = "success" | "failure" | "in_progress" | "unknown";

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  opened_at: string;
  stale: boolean;
}

export interface RepoActivity {
  repo_id: string;
  name: string;
  category: string;
  owner: string;
  repo: string;
  ci_status: CiStatus;
  open_issue_count: number | null;
  open_pr_count: number | null;
  open_pull_requests: PullRequestSummary[];
  commits_last_7d: number | null;
  last_commit_at: string | null;
  checked_at: string;
  cached: boolean;
  detail: string | null;
  private: boolean;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  languages: Record<string, number>;
  commit_weeks: CommitWeek[];
  pull_request_history: PullRequestDates[];
}

/** One GitHub stats week: Sunday 00:00 UTC, then commits per day starting Sunday. */
export interface CommitWeek {
  week: string;
  days: number[];
}

export interface PullRequestDates {
  opened_at: string;
  merged_at: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  domain: string;
  description: string;
  scope: string[];
  last_run_at: string | null;
  last_run_note: string | null;
}

export interface CIEvent {
  id: number;
  app_id: string;
  repo: string;
  event_type: string;
  ci_status: CiStatus;
  details: string;
  received_at: string;
  notified: boolean;
}

export interface UsageWindow {
  used_pct: number;
  resets_at: string;
}

export interface ClaudeUsage {
  session: UsageWindow;
  weekly: UsageWindow;
  reported_at: string;
}

export interface CodexUsage {
  primary: UsageWindow;
  secondary: UsageWindow | null;
  plan_type: string | null;
  reported_at: string;
}

export interface ProviderCost {
  period: string;
  total_usd: number;
  by_app: Record<string, number>;
  estimated: boolean;
  reported_at: string;
}

export interface NeonUsage {
  period: string;
  total_compute_hours: number;
  by_app: Record<string, number>;
  reported_at: string;
}

export interface FinancialSnapshot {
  claude: ClaudeUsage | null;
  codex: CodexUsage | null;
  neon: NeonUsage | null;
  fly: ProviderCost | null;
  detail: string | null;
}

export interface SecondBrainSummary {
  counts: Record<string, number>;
  pushed_at: string | null;
  last_commit?: string;
  drafts?: number;
  broken_links?: number;
  wiki_topics?: string[];
}

export interface NoteListItem {
  path: string;
  folder: string;
  title: string;
  aliases: string[];
  status: string | null;
  updated: string | null;
}

export interface NoteRef {
  path: string;
  title: string;
  folder: string;
}

export interface Note extends Omit<NoteListItem, "updated"> {
  body: string;
  frontmatter: Record<string, string>;
  /** Lowercased wikilink target -> note path (null = no such note). */
  link_map: Record<string, string | null>;
  links: NoteRef[];
  backlinks: NoteRef[];
  previews: Record<string, string>;
  portal: string;
}

export interface Portal {
  id: string;
  title: string;
  count: number;
  index_path: string | null;
  description: string;
}

export interface VaultGraph {
  nodes: NoteRef[];
  edges: [string, string][];
}

export type HistoryRange = "24h" | "7d" | "30d";

export interface HealthHistory {
  app_id: string;
  range: HistoryRange;
  summary: {
    checks: number;
    uptime_pct: number | null;
    avg_response_ms: number | null;
    p95_response_ms: number | null;
    last_state: HealthState | null;
    last_checked_at: string | null;
  };
  points: { t: string; state: HealthState; response_ms: number | null }[];
}

export interface FlyRelease {
  version: number;
  status: string;
  description: string;
  reason: string;
  createdAt: string;
  imageRef: string;
}

export interface Deployments {
  app_id: string;
  fly_app: string | null;
  releases: FlyRelease[];
}

export interface LogLine {
  timestamp: string | null;
  level: string | null;
  message: string | null;
  instance: string | null;
  region: string | null;
}

export interface AppLogs {
  app_id: string;
  fly_app: string | null;
  lines: LogLine[];
}

export interface AutomationStatus {
  id: string;
  name: string;
  kind: "push" | "event" | "poller";
  detail: string;
  last_run_at: string | null;
  expected_hours: number | null;
  status: "ok" | "stale" | "never" | "disabled";
}

export interface ConfigItem {
  key: string;
  label: string;
  used_for: string;
  configured: boolean;
}

export interface MetricsHistory {
  app_id: string;
  range: HistoryRange;
  series: Record<string, { t: string; value: number }[]>;
}

export type NewsState = "new" | "saved" | "dismissed";

export interface NewsItem {
  id: number;
  url: string;
  title: string;
  source: string;
  topic: string;
  published_at: string;
  score: number;
  why: string;
  state: NewsState;
}

export interface NewsFeedStatus {
  feed_url: string;
  source: string;
  last_ok_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

export interface NewsResponse {
  topics: string[];
  items: NewsItem[];
  sources: NewsFeedStatus[];
  freshness_at: string | null;
}

export type League = "NFL" | "NBA" | "MLB" | "NCAAF" | "NCAAB";

export interface SportsEvent {
  id: string;
  league: League;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  start_at: string;
  home_conference: string | null;
  away_conference: string | null;
  home_rank: number | null;
  away_rank: number | null;
  poll_date: string | null;
  url: string | null;
}

export interface SportsResponse {
  events: SportsEvent[];
  priority: SportsEvent[];
  priority_teams: Record<string, League>;
  official_links: Record<League, string>;
  rankings: { poll_date: string | null; current: boolean };
  configured: boolean;
  freshness_at: string | null;
  last_error: string | null;
}

export interface ShoeWatch {
  id: number;
  kind: "search" | "release" | "stockx";
  name: string;
  keywords: string;
  size: string | null;
  condition: string | null;
  max_price: number | null;
  url: string | null;
}

export interface ShoeListing {
  id: number;
  watch_id: number;
  watch_name: string;
  title: string;
  price: number | null;
  prev_price: number | null;
  condition: string | null;
  source: string;
  url: string;
  observed_at: string;
  changed_at: string | null;
  sightings: number;
  history: { price: number | null; observed_at: string }[];
}

export interface ShoesResponse {
  watches: ShoeWatch[];
  listings: ShoeListing[];
  configured: boolean;
  freshness_at: string | null;
}

export type NewShoeWatch = Omit<ShoeWatch, "id">;

export interface Connection {
  provider: string;
  available: boolean;
  connected: boolean;
}

export type OwnKind = "purchase" | "watch" | "bid" | "listing" | "sale";

export interface OwnItem {
  id: number;
  provider: string;
  kind: OwnKind;
  external_id: string;
  title: string;
  price: number | null;
  url: string | null;
  occurred_at: string | null;
}

export interface OwnResponse {
  items: OwnItem[];
  connections: Connection[];
}
