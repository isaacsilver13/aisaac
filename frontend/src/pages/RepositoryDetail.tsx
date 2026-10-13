import { Link, useParams } from "react-router-dom";

import { fetchAnalytics, fetchComsEvents } from "../api";
import { CommitHeatmap, LanguagesChart, PullRequestChart, WeeklyCommitsChart } from "../components/analytics/GitHubCharts";
import { CiStatusBadge } from "../components/CiStatusBadge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { Skeleton, SkeletonStack } from "../components/primitives/Skeleton";
import { Stat } from "../components/primitives/Stat";
import { Table, type Column } from "../components/primitives/Table";
import { useCallback } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestampOrDash } from "../time";
import type { CIEvent, PullRequestSummary } from "../types";

const when = centralTimestampOrDash;

const prColumns: Column<PullRequestSummary>[] = [
  { key: "number", header: "#", align: "right", sortValue: (p) => p.number, render: (p) => p.number },
  { key: "title", header: "Title", sortValue: (p) => p.title, render: (p) => <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> },
  { key: "opened", header: "Opened", sortValue: (p) => p.opened_at, render: (p) => when(p.opened_at) },
  { key: "stale", header: "Flag", sortValue: (p) => (p.stale ? 1 : 0), render: (p) => (p.stale ? "stale" : "—") },
];

const eventColumns: Column<CIEvent>[] = [
  { key: "when", header: "Received", sortValue: (e) => e.received_at, render: (e) => when(e.received_at) },
  { key: "type", header: "Event", sortValue: (e) => e.event_type, render: (e) => e.event_type },
  { key: "ci", header: "CI", sortValue: (e) => e.ci_status, render: (e) => <CiStatusBadge status={e.ci_status} /> },
  { key: "details", header: "Details", render: (e) => e.details },
];

export default function RepositoryDetail() {
  const { repo: id = "" } = useParams();
  const repos = useAsyncData(fetchAnalytics);
  const events = useAsyncData(useCallback(() => fetchComsEvents(id), [id]));

  const back = <Link className="ui-stat-label" to="/github/repositories">← All repositories</Link>;
  if (repos.error) return <ErrorState message={repos.error} onRetry={() => void repos.reload(true)} />;
  if (repos.loading) return <>{back}<LoadingBoundary loading hasData={false} label="Loading repository" skeleton={<><Skeleton height={120} /><div style={{ height: 12 }} /><SkeletonStack rows={5} rowHeight={46} /></>} empty={null}>{null}</LoadingBoundary></>;
  const repo = repos.data?.find((r) => r.repo_id === id);
  if (!repo) return <>{back}<EmptyState message="That repository is not tracked, or it is private and no dashboard token is saved." /></>;

  return (
    <>
      {back}
      <PageHeader
        title={repo.name}
        description={repo.detail ?? repo.description ?? undefined}
        actions={<a href={`https://github.com/${repo.owner}/${repo.repo}`} target="_blank" rel="noreferrer">{repo.owner}/{repo.repo}</a>}
      />
      <Card>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <Stat label="CI" value={<CiStatusBadge status={repo.ci_status} />} />
          <Stat label="Open PRs" value={repo.open_pr_count ?? "—"} />
          <Stat label="Open issues" value={repo.open_issue_count ?? "—"} />
          <Stat label="Commits, 7d" value={repo.commits_last_7d ?? "—"} />
          <Stat label="Last commit" value={when(repo.last_commit_at)} />
          <Stat label="Last push" value={when(repo.pushed_at)} />
          <Stat label="Language" value={repo.language ?? "—"} />
          <Stat label="Visibility" value={repo.private ? "Private" : "Public"} />
        </div>
      </Card>

      <div className="activity-feed-section">
        <CommitHeatmap repos={[repo]} />
      </div>
      <div className="activity-feed-section">
        <WeeklyCommitsChart repos={[repo]} />
      </div>
      <div className="analytics-chart-row">
        <PullRequestChart repos={[repo]} />
        <LanguagesChart repos={[repo]} />
      </div>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Open pull requests</div>
      <Table columns={prColumns} rows={repo.open_pull_requests} rowKey={(p) => String(p.number)} emptyMessage="No open pull requests." />

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>CI events</div>
      {events.error ? (
        <ErrorState message={events.error} onRetry={() => void events.reload()} />
      ) : (
        <LoadingBoundary
          loading={events.loading}
          hasData={Boolean(events.data)}
          label="Loading CI events"
          skeleton={<SkeletonStack rows={4} rowHeight={44} />}
          empty={<EmptyState message="No CI event data is available." />}
        >
          <Table columns={eventColumns} rows={events.data ?? []} rowKey={(e) => String(e.id)} emptyMessage="No CI events received." />
        </LoadingBoundary>
      )}
    </>
  );
}
