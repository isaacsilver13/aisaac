import { Refresh } from "iconoir-react";
import { Link } from "react-router-dom";

import { fetchAnalytics } from "../api";
import { CommitActivityChart } from "../components/analytics/CommitActivityChart";
import { CommitHeatmap, LanguagesChart, PullRequestChart, WeeklyCommitsChart } from "../components/analytics/GitHubCharts";
import { commitStreaks, dailyCommits } from "../components/analytics/githubStats";
import { Card } from "../components/primitives/Card";
import { ErrorState } from "../components/primitives/ErrorState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Skeleton } from "../components/primitives/Skeleton";
import { Stat } from "../components/primitives/Stat";
import { useAsyncData } from "../hooks/useAsyncData";
import type { RepoActivity } from "../types";

function sumField(repos: RepoActivity[], select: (repo: RepoActivity) => number | null): number {
  return repos.reduce((total, repo) => total + (select(repo) ?? 0), 0);
}

export default function Analytics() {
  const { data: activity, loading, refreshing, error, reload } = useAsyncData(fetchAnalytics);
  const repos = activity ?? [];

  const openPrCount = sumField(repos, (repo) => repo.open_pr_count);
  const openIssueCount = sumField(repos, (repo) => repo.open_issue_count);
  const commitCount = sumField(repos, (repo) => repo.commits_last_7d);
  const privateCount = repos.filter((repo) => repo.private).length;
  const streak = commitStreaks(dailyCommits(repos));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Activity across every non-archived isaacsilver13 repo. Private repos appear once the dashboard token is saved."
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Checking" : "Refresh"}</span>
          </button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void reload(true)} retrying={refreshing} />
      ) : loading ? (
        <div className="analytics-top-row" aria-label="Loading analytics">
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
          <Skeleton height={100} />
        </div>
      ) : (
        <>
          <div className="analytics-top-row">
            <Card><Stat label={privateCount ? `Repositories (${privateCount} private)` : "Repositories"} value={repos.length} /></Card>
            <Card><Stat label="Open pull requests" value={openPrCount} /></Card>
            <Card><Stat label="Open issues" value={openIssueCount} /></Card>
            <Card><Stat label="Commits, last 7 days" value={commitCount} /></Card>
            <Card><Stat label={`Commit streak (longest ${streak.longest} d)`} value={`${streak.current} d`} /></Card>
          </div>

          <CommitHeatmap repos={repos} />
          <div className="activity-feed-section">
            <WeeklyCommitsChart repos={repos} />
          </div>
          <div className="analytics-chart-row">
            <PullRequestChart repos={repos} />
            <LanguagesChart repos={repos} />
          </div>
          <div className="activity-feed-section">
            <CommitActivityChart activity={repos} />
          </div>
        </>
      )}

      {!loading && !error && (
        <div className="activity-feed-section">
          <Link to="/github/repositories">All repositories →</Link>
        </div>
      )}
    </>
  );
}
