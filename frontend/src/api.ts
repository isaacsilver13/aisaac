import type { AssistantBrief, NewShoeWatch, OwnResponse, NewsResponse, ShoesResponse, SportsResponse, NewsState, AutomationStatus, AutomationRun, ConfigItem, AppInfo, AppLogs, Deployments, HealthHistory, HistoryRange, LearningModule, PushPref, AgentSummary, CIEvent, DashboardResponse, FinancialSnapshot, Incident, Note, NoteListItem, Portal, RepoActivity, SecondBrainSummary, VaultGraph } from "./types";
import { readToken, readWriteToken } from "./token";

export class FinancialsAuthError extends Error {}

export async function fetchFinancials(token: string): Promise<FinancialSnapshot> {
  const response = await fetch("/api/v1/command-center/financials", {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) {
    throw new FinancialsAuthError("Invalid dashboard token.");
  }
  if (!response.ok) {
    throw new Error(`Financials request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as FinancialSnapshot;
}

export async function fetchDashboard(forceRefresh = false, token = readToken()): Promise<DashboardResponse> {
  const query = forceRefresh && token ? "?force_refresh=true" : "";
  const response = await fetch(`/api/v1/dashboard${query}`, {
    headers: token ? { Accept: "application/json", "X-Dashboard-Token": token } : { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Dashboard request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as DashboardResponse;
}

export async function fetchIncidents(token = readToken()): Promise<Incident[]> {
  const response = await fetch("/api/v1/incidents", {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (!response.ok) {
    throw new Error(`Incidents request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as Incident[];
}

export async function resolveIncident(
  incidentId: number,
  notes?: string,
  writeToken = readWriteToken(),
): Promise<void> {
  const response = await fetch(`/api/v1/incidents/${incidentId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dashboard-Write-Token": writeToken },
    body: JSON.stringify({ notes: notes ?? null }),
  });
  if (!response.ok) {
    throw new Error(`Resolve incident failed with HTTP ${response.status}.`);
  }
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetch("/api/v1/agents", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Agents request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as AgentSummary[];
}

export async function fetchAnalytics(forceRefresh = false, token = readToken()): Promise<RepoActivity[]> {
  const query = forceRefresh && token ? "?force_refresh=true" : "";
  // The read token is optional here: with it, private repos are included.
  const response = await fetch(`/api/v1/analytics${query}`, {
    headers: token ? { Accept: "application/json", "X-Dashboard-Token": token } : { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Analytics request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as RepoActivity[];
}

export async function fetchComsEvents(appId?: string, token = readToken()): Promise<CIEvent[]> {
  const query = appId ? `?app_id=${encodeURIComponent(appId)}` : "";
  const response = await fetch(`/api/v1/coms${query}`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (!response.ok) {
    throw new Error(`Coms request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as CIEvent[];
}

export async function fetchRunbook(appId: string): Promise<string | null> {
  const response = await fetch(`/api/v1/runbooks/${appId}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Runbook request failed with HTTP ${response.status}.`);
  }
  return response.text();
}

async function secondBrainGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api/v1/second-brain/${path}`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Second brain request failed with HTTP ${response.status}.`);
  return (await response.json()) as T;
}

export const fetchSecondBrainSummary = (token: string) =>
  secondBrainGet<SecondBrainSummary>("summary", token);

export const fetchNotes = (token: string, q = "", folder = "") =>
  secondBrainGet<NoteListItem[]>(
    `notes?q=${encodeURIComponent(q)}&folder=${encodeURIComponent(folder)}`,
    token,
  );

export const fetchNote = (token: string, path: string) =>
  secondBrainGet<Note>(`notes/${path.split("/").map(encodeURIComponent).join("/")}`, token);

export async function fetchHealthHistory(appId: string, range: HistoryRange): Promise<HealthHistory> {
  const response = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/health-history?range=${range}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Health history request failed with HTTP ${response.status}.`);
  return (await response.json()) as HealthHistory;
}

export async function fetchDeployments(appId: string, token: string): Promise<Deployments> {
  const response = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/deployments`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Deployments request failed with HTTP ${response.status}.`);
  return (await response.json()) as Deployments;
}

export async function fetchLogs(appId: string, token: string): Promise<AppLogs> {
  const response = await fetch(`/api/v1/apps/${encodeURIComponent(appId)}/logs`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Logs request failed with HTTP ${response.status}.`);
  return (await response.json()) as AppLogs;
}

export async function fetchAutomations(token: string): Promise<AutomationStatus[]> {
  const response = await fetch("/api/v1/automations", {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Automations request failed with HTTP ${response.status}.`);
  return (await response.json()) as AutomationStatus[];
}

export async function fetchAutomationRuns(token: string, id: string): Promise<AutomationRun[]> {
  const response = await fetch(`/api/v1/automations/${encodeURIComponent(id)}/runs`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (!response.ok) throw new Error(`Run history request failed with HTTP ${response.status}.`);
  return (await response.json()) as AutomationRun[];
}

export async function fetchConfigStatus(token: string): Promise<ConfigItem[]> {
  const response = await fetch("/api/v1/config-status", {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Config request failed with HTTP ${response.status}.`);
  return ((await response.json()) as { items: ConfigItem[] }).items;
}

export async function fetchApps(): Promise<AppInfo[]> {
  const token = readToken();
  // The read token is optional here: with it, each app's stack map is included.
  const response = await fetch("/api/v1/apps", {
    headers: token ? { Accept: "application/json", "X-Dashboard-Token": token } : { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Applications request failed with HTTP ${response.status}.`);
  return (await response.json()) as AppInfo[];
}

export const fetchPortals = (token: string) => secondBrainGet<Portal[]>("portals", token);

export const fetchGraph = (token: string) => secondBrainGet<VaultGraph>("graph", token);

export async function fetchLearningModule(token: string, day = ""): Promise<LearningModule> {
  const response = await fetch(`/api/v1/learning/module${day ? `?day=${encodeURIComponent(day)}` : ""}`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (response.status === 404) throw new Error("No study notes synced yet. Run scripts/second_brain_push.py.");
  if (!response.ok) throw new Error(`Learning request failed with HTTP ${response.status}.`);
  return (await response.json()) as LearningModule;
}

export async function completeLearningModule(day: string, path: string, writeToken = readWriteToken()): Promise<string> {
  const response = await fetch("/api/v1/learning/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dashboard-Write-Token": writeToken },
    body: JSON.stringify({ day, path }),
  });
  if (!response.ok) throw new Error(`Saving progress failed with HTTP ${response.status}.`);
  return ((await response.json()) as { completed_at: string }).completed_at;
}

const STALE_NEWS_MS = 60 * 60 * 1000;

export async function getNews(token: string): Promise<NewsResponse> {
  const response = await fetch("/api/v1/personal/news", {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`News request failed with HTTP ${response.status}.`);
  return (await response.json()) as NewsResponse;
}

/** Loads the stored snapshot; refreshes upstream first on a manual request or when it is over an hour old. */
export async function fetchNews(token: string, forceRefresh = false): Promise<NewsResponse> {
  let news = await getNews(token);
  const age = news.freshness_at ? Date.now() - new Date(news.freshness_at).getTime() : Infinity;
  if (forceRefresh || age > STALE_NEWS_MS) {
    // A failed refresh must not hide the last good snapshot; per-feed errors show in `sources`.
    await fetch("/api/v1/personal/news/refresh", { method: "POST", headers: { "X-Dashboard-Token": token } }).catch(() => undefined);
    news = await getNews(token);
  }
  return news;
}

export async function setNewsState(itemId: number, state: NewsState, writeToken = readWriteToken()): Promise<void> {
  const response = await fetch(`/api/v1/personal/news/${itemId}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dashboard-Write-Token": writeToken },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) throw new Error(`Update failed with HTTP ${response.status}.`);
}

async function getPersonal<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`/api/v1/personal/${path}`, {
    headers: { Accept: "application/json", "X-Dashboard-Token": token },
  });
  if (response.status === 401) throw new FinancialsAuthError("Invalid dashboard token.");
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);
  return (await response.json()) as T;
}

/** Loads the stored snapshot; refreshes upstream first only on an explicit manual refresh. */
async function fetchRefreshed<T>(path: string, token: string, forceRefresh: boolean): Promise<T> {
  if (forceRefresh) {
    // A failed refresh must not hide the last good snapshot.
    await fetch(`/api/v1/personal/${path}/refresh`, { method: "POST", headers: { "X-Dashboard-Token": token } }).catch(() => undefined);
  }
  return getPersonal<T>(path, token);
}

export const fetchSports = (token: string, forceRefresh = false) => fetchRefreshed<SportsResponse>("sports", token, forceRefresh);

export const fetchAssistant = (token: string) => getPersonal<AssistantBrief>("assistant", token);

export const fetchShoes = (token: string, forceRefresh = false) => fetchRefreshed<ShoesResponse>("shoes", token, forceRefresh);

export async function createShoeWatch(watch: NewShoeWatch, writeToken = readWriteToken()): Promise<void> {
  const response = await fetch("/api/v1/personal/shoes/watches", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dashboard-Write-Token": writeToken },
    body: JSON.stringify(watch),
  });
  if (!response.ok) throw new Error(`Save failed with HTTP ${response.status}.`);
}

export async function archiveShoeWatch(id: number, writeToken = readWriteToken()): Promise<void> {
  const response = await fetch(`/api/v1/personal/shoes/watches/${id}`, {
    method: "DELETE",
    headers: { "X-Dashboard-Write-Token": writeToken },
  });
  if (!response.ok) throw new Error(`Archive failed with HTTP ${response.status}.`);
}

export const fetchOwn = (token: string, forceRefresh = false) => fetchRefreshed<OwnResponse>("own", token, forceRefresh);

export async function startConnect(provider: string, writeToken = readWriteToken()): Promise<string> {
  const response = await fetch(`/api/v1/personal/connect/${provider}`, { headers: { "X-Dashboard-Write-Token": writeToken } });
  if (!response.ok) throw new Error(`Connect failed with HTTP ${response.status}.`);
  return ((await response.json()) as { url: string }).url;
}

export async function disconnectProvider(provider: string, writeToken = readWriteToken()): Promise<void> {
  const response = await fetch(`/api/v1/personal/connections/${provider}`, { method: "DELETE", headers: { "X-Dashboard-Write-Token": writeToken } });
  if (!response.ok) throw new Error(`Disconnect failed with HTTP ${response.status}.`);
}

export const fetchPushPrefs = (token: string) => getPersonal<PushPref[]>("pushes", token);

export async function setPushPref(kind: string, enabled: boolean, writeToken = readWriteToken()): Promise<void> {
  const response = await fetch(`/api/v1/personal/pushes/${encodeURIComponent(kind)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Dashboard-Write-Token": writeToken },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error(`Saving failed with HTTP ${response.status}.`);
}
