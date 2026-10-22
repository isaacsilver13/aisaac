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
  job_statuses?: Record<string, CiStatus>;
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
  machine_hours?: Record<string, number>;
  invoice_total_usd?: number | null;
  estimated: boolean;
  reported_at: string;
}

export interface NeonUsage {
  period: string;
  total_compute_hours: number;
  by_app: Record<string, number>;
  plan?: string | null;
  free_hours_per_project?: number | null;
  reported_at: string;
}

/** One registry app's Fly + Neon figures (or an unmapped Fly app / Neon project). */
export interface HostingCostRow {
  key: string;
  name: string;
  fly_usd: number | null;
  fly_hours: number | null;
  neon_usd: number | null;
  neon_hours: number | null;
  neon_allowance_pct: number | null;
  total_usd: number;
}

export interface FinancialSnapshot {
  claude: ClaudeUsage | null;
  codex: CodexUsage | null;
  neon: NeonUsage | null;
  fly: ProviderCost | null;
  hosting: HostingCostRow[];
  hosting_total_usd: number | null;
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
  status: "ok" | "stale" | "failing" | "never" | "disabled";
  next_expected_at: string | null;
  overdue_hours: number | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface AutomationRun {
  ran_at: string;
  ok: boolean;
  detail: string;
}

export interface ConfigItem {
  key: string;
  label: string;
  used_for: string;
  configured: boolean;
}

export type StackNodeKind = "ui" | "api" | "job" | "database" | "provider";

export interface StackNode {
  kind: StackNodeKind;
  name: string;
  tech: string;
  /** Nodes sharing a host render inside one hosting boundary. */
  host: string | null;
  detail: string;
}

export interface AppStack {
  description: string;
  region: string | null;
  nodes: StackNode[];
  monitoring: string;
}

/** Public registry entry from /api/v1/apps. */
export interface AppInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  product_url: string | null;
  health_url: string | null;
  readiness_url: string | null;
  metrics_url: string | null;
  monitor_target: "health" | "page" | "push";
  fly_app: string | null;
  stack: AppStack | null;
}

export type NewsState = "new" | "read" | "saved" | "dismissed";

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
  priority_teams: Record<string, League[]>;
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

export interface LearningQuestion {
  kind: "cloze" | "relation";
  prompt: string;
  answer: string;
  path?: string;
}

export interface LearningExercise {
  kind: "match" | "explain" | "investigate" | "reflect";
  prompt: string;
  pairs?: { path: string; term: string; definition: string }[];
  options?: string[];
}

export interface PushPref {
  kind: string;
  /** Send hour, America/Chicago. */
  hour: number;
  enabled: boolean;
}

export interface PhilosophyEntry {
  id: string;
  school: "stoic" | "existentialist";
  author: string;
  source: string;
  /** True for Sartre/Camus/de Beauvoir: our own summary, not a quotation. */
  paraphrase: boolean;
  passage: string;
  theme: string;
  morning_prompt: string;
  evening_question: string;
}

export interface JournalRow {
  local_date: string;
  entry_id: string;
  intention: string | null;
  reflection: string | null;
  updated_at: string;
  author?: string | null;
  theme?: string | null;
}

export interface PhilosophyToday {
  date: string;
  entry: PhilosophyEntry;
  journal: JournalRow | null;
}

export interface LearningModule {
  date: string;
  path: string;
  title: string;
  portal: string;
  link_map: Record<string, string | null>;
  reading: { heading: string; markdown: string }[];
  questions: LearningQuestion[];
  exercises: LearningExercise[];
  completed_at: string | null;
}

export type BriefState = "ok" | "not_connected" | "fetch_failed" | "stale";

export interface CalendarEvent {
  title: string;
  all_day: boolean;
  start: string;
  end: string | null;
  location: string | null;
}

export interface ProjectWorktree {
  folder: string;
  branch: string | null;
  last_commit_at: string | null;
  last_commit_subject: string;
  dirty_files: number;
  ahead: number | null;
}

export interface ProjectBrief {
  folder: string;
  slug: string | null;
  last_activity_at: string | null;
  note: { branch: string; updated_at: string; text: string } | null;
  other_notes: number;
  worktrees: ProjectWorktree[];
  ci_status: "success" | "failure" | "in_progress" | "unknown";
  open_prs: { number: number; title: string; url: string; opened_at: string }[];
  reasons: string[];
}

/** gym_tracker's ExerciseProgressPoint. */
export interface GymSet {
  logged_at: string;
  weight_lb: number;
  reps_done: number;
}

/** gym_tracker GET /api/v1/assistant/summary (AssistantSummaryOut). */
export interface GymSummary {
  username: string;
  routine: { id: number; name: string; is_active: boolean } | null;
  next_gym_day: { id: number; name: string } | null;
  last_session_date: string | null;
  exercises: {
    id: number;
    name: string;
    muscle_group: string;
    gym_day: string;
    latest: GymSet | null;
    best_30d: GymSet | null;
  }[];
}

export interface AssistantBrief {
  generated_at: string;
  calendar: { state: BriefState; events: CalendarEvent[] };
  projects: { state: BriefState; reported_at: string | null; projects: ProjectBrief[] };
  games: {
    configured: boolean;
    priority: SportsEvent[];
    top_25: SportsEvent[];
    slate: Record<"NFL" | "NBA", SportsEvent[]>;
  };
  gym: { state: BriefState; app_url: string | null; data: GymSummary | null };
}

/** bet_watch's daily NBA report (contract: bet_watch PR #11). Probabilities, ev, kelly_frac and avg_clv are fractions. */
export interface NbaGame {
  game_id: number | null;
  home: string;
  away: string;
  tip: string | null;
  pred_margin: number;
  p_home_win: number;
  market_spread_home: number | null;
  market_home_win_prob: number | null;
  books: number;
}

export interface NbaPick {
  tier: "targeted" | "watchlist";
  game_id: number | null;
  home: string;
  away: string;
  tip: string | null;
  market: string;
  side: string;
  team: string;
  line: number | null;
  book: string;
  price_american: number;
  model_prob: number;
  market_prob: number;
  ev: number;
  kelly_frac: number;
}

export interface NbaTrackRecord {
  tier: "targeted" | "watchlist";
  picks: number;
  graded: number;
  won: number;
  lost: number;
  push: number;
  flat_roi: number | null;
  avg_clv: number | null;
  clv_samples: number;
  /** 0–100, unlike the other fractions. */
  beat_close_pct: number | null;
}

export interface NbaReport {
  kind: "nba_daily_report";
  slate_date: string;
  generated_at: string;
  model_version: string;
  data_through: string | null;
  odds_as_of: string | null;
  games: NbaGame[];
  picks: NbaPick[];
  track_record: NbaTrackRecord[];
  received_at: string;
}

export type BookStatus = "queued" | "listening" | "done";

export interface BookRecommendation {
  title: string;
  author: string;
  why: string;
  apple_url: string | null;
  audible_search_url: string;
  libby_search_url: string;
}

export interface BookMapNode {
  id: string;
  label: string;
  kind: "theme" | "concept" | "example";
  summary: string;
}

export interface BookMap {
  nodes: BookMapNode[];
  edges: { source: string; target: string; label: string }[];
}

export interface BookRow {
  id: number;
  title: string;
  author: string;
  apple_url: string | null;
  status: BookStatus;
  added_at: string;
}

export interface Book extends BookRow {
  map: BookMap;
}
