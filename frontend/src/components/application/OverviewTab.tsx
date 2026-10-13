import { useCallback } from "react";

import { fetchAnalytics, fetchComsEvents, fetchDashboard } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { CheckResult, HealthState } from "../../types";
import { CiStatusBadge } from "../CiStatusBadge";
import { StatusBadge } from "../StatusBadge";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { LoadingBoundary } from "../primitives/LoadingBoundary";
import { Skeleton, SkeletonStack } from "../primitives/Skeleton";
import { Stat } from "../primitives/Stat";
import { centralTimestampOrDash, exactTimestamp, humanizeTimestamp } from "../../time";

const when = centralTimestampOrDash;
const state = (s: HealthState | string | null) => s ?? "—";

/** Liveness, provider, readiness and freshness stay separate signals (see CLAUDE.md). */
function Signals({ r }: { r: CheckResult }) {
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
      <Stat label="Response" value={r.response_ms === null ? "—" : `${Math.round(r.response_ms)} ms`} />
      <Stat label="HTTP" value={r.http_status ?? "—"} />
      <Stat label="Readiness" value={state(r.readiness)} />
      <Stat label="Provider" value={state(r.provider_state)} />
      <Stat
        label="Freshness"
        value={r.freshness ? <time dateTime={r.freshness} title={exactTimestamp(r.freshness)}>{humanizeTimestamp(r.freshness)}</time> : "—"}
      />
      <Stat label="Page" value={state(r.page_state)} />
    </div>
  );
}

export function OverviewTab({ appId }: { appId: string }) {
  const dashboard = useAsyncData(fetchDashboard);
  const repos = useAsyncData(fetchAnalytics);
  const events = useAsyncData(useCallback(() => fetchComsEvents(appId), [appId]));

  if (dashboard.error) return <ErrorState message={dashboard.error} onRetry={() => void dashboard.reload()} />;
  const result = dashboard.data?.results.find((r) => r.app_id === appId);
  const repo = Array.isArray(repos.data) ? repos.data.find((r) => r.repo_id === appId) : undefined;

  return (
    <LoadingBoundary
      loading={dashboard.loading}
      hasData={Boolean(result)}
      label="Loading application overview"
      skeleton={<><Skeleton height={126} /><div style={{ height: 12 }} /><Skeleton height={120} /><div style={{ height: 12 }} /><Skeleton height={120} /></>}
      empty={<EmptyState message="This application is not registered." />}
    >
      {result && <>
      <Card>
        <div style={{ alignItems: "center", display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div className="ui-stat-label">{result.category}</div>
            <p style={{ margin: "4px 0 0" }}>{result.description}</p>
          </div>
          <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
            <StatusBadge state={result.state} />
            {result.product_url && <a href={result.product_url} target="_blank" rel="noreferrer">Open app</a>}
          </div>
        </div>
        {result.detail && <p className="ui-stat-label" style={{ marginTop: 12 }}>{result.detail}</p>}
        <div className="ui-stat-label" style={{ marginTop: 12 }}>Checked {when(result.checked_at)}{result.cached ? " (cached)" : ""}</div>
      </Card>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Snapshot</div>
      <Card>
        {Object.keys(result.metrics).length > 0 ? (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            {Object.entries(result.metrics).map(([key, value]) => <Stat key={key} label={key} value={String(value)} />)}
          </div>
        ) : (
          <EmptyState message="This app reports no metrics." />
        )}
      </Card>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Signals</div>
      <Card><Signals r={result} /></Card>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Repository</div>
      <Card>
        <LoadingBoundary loading={repos.loading} hasData={Boolean(repo)} label="Loading repository summary" skeleton={<SkeletonStack rows={2} rowHeight={38} />} empty={<EmptyState message={repos.error ?? "No repository data for this app."} />}>
          {repo && (
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              <Stat label="CI" value={<CiStatusBadge status={repo.ci_status} />} />
              <Stat label="Open PRs" value={repo.open_pr_count ?? "—"} />
              <Stat label="Open issues" value={repo.open_issue_count ?? "—"} />
              <Stat label="Commits, 7d" value={repo.commits_last_7d ?? "—"} />
              <Stat label="Last commit" value={when(repo.last_commit_at)} />
            </div>
          )}
        </LoadingBoundary>
      </Card>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Recent CI events</div>
      <Card>
        <LoadingBoundary loading={events.loading} hasData={Boolean(events.data)} label="Loading recent CI events" skeleton={<SkeletonStack rows={4} rowHeight={34} />} empty={<EmptyState message={events.error ?? "No CI event data is available."} />}>
          {events.data && events.data.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} style={{ alignItems: "center", display: "flex", gap: 12, padding: "4px 0" }}>
                  <CiStatusBadge status={e.ci_status} />
                  <span>{e.event_type}</span>
                  <span className="ui-stat-label">{when(e.received_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No CI events received." />
          )}
        </LoadingBoundary>
      </Card>
      </>}
    </LoadingBoundary>
  );
}
