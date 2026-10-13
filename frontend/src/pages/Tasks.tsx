import { useState } from "react";
import { Refresh } from "iconoir-react";
import { Link } from "react-router-dom";

import { fetchAnalytics, fetchAutomations, fetchComsEvents, fetchIncidents } from "../api";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SectionHeader } from "../components/primitives/SectionHeader";
import { StatusDot } from "../components/primitives/StatusDot";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { Table, type Column } from "../components/primitives/Table";
import type { Tone } from "../components/primitives/tone";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp } from "../time";
import { readToken } from "../token";
import type { AutomationStatus, CIEvent, Incident, RepoActivity } from "../types";

type Kind = "Pull request" | "Incident" | "CI failure" | "Automation";

interface Task {
  key: string;
  kind: Kind;
  title: string;
  /** External (https) or in-app path. */
  url: string | null;
  source: string;
  opened: string | null;
  tone: Tone;
  flag: string;
}

const SEVERITY: Record<Tone, number> = { error: 0, warning: 1, info: 2, neutral: 3, success: 4 };
const DAY_MS = 86_400_000;
const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)) : null);

// Module-level loaders keep useAsyncData's fetcher identity stable across renders.
// Token-gated sources load as empty without a token, so PRs and CI still show.
const loadIncidents = (): Promise<Incident[]> => (readToken() ? fetchIncidents() : Promise.resolve([]));
const loadAutomations = (): Promise<AutomationStatus[]> => {
  const token = readToken();
  return token ? fetchAutomations(token) : Promise.resolve([]);
};
const loadCi = () => fetchComsEvents();

/** Pure merge of every source into one triage list, most urgent first. */
function buildTasks(repos: RepoActivity[], incidents: Incident[], events: CIEvent[], automations: AutomationStatus[]): Task[] {
  const name = (id: string) => repos.find((r) => r.repo_id === id)?.name ?? id;
  const latestPerApp = new Map<string, CIEvent>();
  for (const e of events) {
    const seen = latestPerApp.get(e.app_id);
    if (!seen || e.received_at > seen.received_at) latestPerApp.set(e.app_id, e);
  }
  const tasks: Task[] = [
    ...repos.flatMap((r) =>
      r.open_pull_requests.map((pr): Task => ({
        key: `pr-${r.repo_id}-${pr.number}`, kind: "Pull request", title: pr.title, url: pr.url,
        source: r.name, opened: pr.opened_at, tone: pr.stale ? "warning" : "neutral", flag: pr.stale ? "stale" : "open",
      })),
    ),
    ...incidents
      .filter((i) => i.resolved_at === null)
      .map((i): Task => ({
        key: `incident-${i.id}`, kind: "Incident", title: i.failure_type, url: `/applications/${i.app_id}/health`,
        source: name(i.app_id), opened: i.started_at, tone: "error", flag: "open",
      })),
    ...[...latestPerApp.values()]
      .filter((e) => e.ci_status === "failure")
      .map((e): Task => ({
        key: `ci-${e.app_id}`, kind: "CI failure", title: e.details || `${e.event_type} failed`,
        url: `https://github.com/${e.repo}/actions`, source: name(e.app_id), opened: e.received_at, tone: "error", flag: "failing",
      })),
    ...automations
      .filter((a) => a.status === "stale" || a.status === "never" || a.status === "failing")
      .map((a): Task => ({
        key: `automation-${a.id}`, kind: "Automation",
        title: a.status === "failing" ? `${a.name}: ${a.last_error ?? "failed"}` : a.status === "never" ? `${a.name} has never reported` : `${a.name} is ${a.overdue_hours ?? 0} h overdue`,
        url: "/automations", source: "AIsaac", opened: a.status === "failing" ? a.last_error_at : a.next_expected_at,
        tone: a.status === "stale" ? "warning" : "error", flag: a.status,
      })),
  ];
  return tasks.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone] || (ageDays(b.opened) ?? -1) - (ageDays(a.opened) ?? -1));
}

const columns: Column<Task>[] = [
  { key: "kind", header: "Kind", sortValue: (t) => t.kind, render: (t) => t.kind },
  {
    key: "title",
    header: "Item",
    sortValue: (t) => t.title,
    render: (t) =>
      !t.url ? t.title : t.url.startsWith("/") ? <Link to={t.url}>{t.title}</Link> : <a href={t.url} target="_blank" rel="noreferrer">{t.title}</a>,
  },
  { key: "source", header: "Source", sortValue: (t) => t.source, render: (t) => t.source },
  { key: "opened", header: "Since", sortValue: (t) => t.opened, render: (t) => (t.opened ? centralTimestamp(t.opened) : "—") },
  {
    key: "age",
    header: "Age",
    align: "right",
    sortValue: (t) => ageDays(t.opened),
    render: (t) => {
      const days = ageDays(t.opened);
      return days === null ? "—" : `${days} d`;
    },
  },
  {
    key: "flag",
    header: "Flag",
    sortValue: (t) => SEVERITY[t.tone],
    render: (t) => (<><StatusDot tone={t.tone} label={t.flag} /> {t.flag}</>),
  },
];

type GroupBy = "none" | "source" | "kind";

function summary(tasks: Task[]): string {
  const counts = new Map<Kind, number>();
  for (const t of tasks) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${n} ${kind === "CI failure" ? kind : kind.toLowerCase()}${n === 1 ? "" : "s"}`);
  const urgent = tasks.filter((t) => t.tone === "error" || t.tone === "warning").length;
  return tasks.length === 0 ? "Nothing open." : `${parts.join(" · ")}. ${urgent} need${urgent === 1 ? "s" : ""} attention.`;
}

export default function Tasks() {
  const repos = useAsyncData(fetchAnalytics);
  const incidents = useAsyncData(loadIncidents);
  const ci = useAsyncData(loadCi);
  const automations = useAsyncData(loadAutomations);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const sources = [repos, incidents, ci, automations];
  const tasks = buildTasks(repos.data ?? [], incidents.data ?? [], ci.data ?? [], automations.data ?? []);
  const error = sources.find((s) => s.error)?.error ?? null;
  const loading = sources.some((s) => s.loading);
  const refreshing = sources.some((s) => s.refreshing);
  const reloadAll = () => void Promise.all(sources.map((s) => s.reload(true)));

  const groups = groupBy === "none" ? [] : [...new Set(tasks.map((t) => t[groupBy]))].sort();

  return (
    <>
      <PageHeader
        title="Tasks"
        description={loading ? "Open PRs, incidents, CI failures and late automations." : summary(tasks)}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="none">No grouping</option>
              <option value="source">Group by app/repo</option>
              <option value="kind">Group by kind</option>
            </select>
            <button className="refresh-button" type="button" disabled={refreshing} onClick={reloadAll}>
              <Refresh width={16} height={16} aria-hidden="true" />
              <span>{refreshing ? "Checking" : "Refresh"}</span>
            </button>
          </div>
        }
      />
      {error && <ErrorState message={error} onRetry={reloadAll} retrying={refreshing} />}
      <RefreshOverlay refreshing={refreshing}>
        <LoadingBoundary
          loading={loading}
          hasData
          label="Loading tasks"
          skeleton={<SkeletonStack rows={5} rowHeight={48} />}
          empty={null}
        >
          {groupBy === "none" ? (
            <Table
              columns={columns}
              rows={tasks}
              rowKey={(t) => t.key}
              searchText={(t) => `${t.title} ${t.source}`}
              filters={[{ label: "Kind", value: (t) => t.kind }, { label: "Source", value: (t) => t.source }, { label: "Flag", value: (t) => t.flag }]}
              emptyMessage="Nothing open."
            />
          ) : (
            groups.map((g) => {
              const rows = tasks.filter((t) => t[groupBy] === g);
              return (
                <section key={g} style={{ marginBottom: 24 }}>
                  <SectionHeader title={`${g} (${rows.length})`} />
                  <Table columns={columns} rows={rows} rowKey={(t) => t.key} />
                </section>
              );
            })
          )}
        </LoadingBoundary>
      </RefreshOverlay>
    </>
  );
}
