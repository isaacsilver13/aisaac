import { Refresh } from "iconoir-react";

import { fetchAnalytics } from "../api";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { Table } from "../components/primitives/Table";
import { repoColumns, repoFilters, repoSearchText } from "../components/RepoActivityCard";
import { useAsyncData } from "../hooks/useAsyncData";

export default function Repositories() {
  const { data, loading, refreshing, error, reload } = useAsyncData(fetchAnalytics);
  const repos = data ?? [];

  return (
    <>
      <PageHeader
        title="Repositories"
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Checking" : "Refresh"}</span>
          </button>
        }
      />
      {error ? (
        <ErrorState message={error} onRetry={() => void reload(true)} retrying={refreshing} />
      ) : (
        <RefreshOverlay refreshing={refreshing}>
          <LoadingBoundary
            loading={loading}
            hasData={repos.length > 0}
            label="Loading repositories"
            skeleton={<SkeletonStack rows={6} rowHeight={52} />}
            empty={<EmptyState message="No repositories found for isaacsilver13." />}
          >
            <Table columns={repoColumns} rows={repos} rowKey={(r) => r.repo_id} searchText={repoSearchText} filters={repoFilters} />
          </LoadingBoundary>
        </RefreshOverlay>
      )}
    </>
  );
}
