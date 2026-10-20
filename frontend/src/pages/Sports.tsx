import { useCallback, useState } from "react";
import { Refresh } from "iconoir-react";

import { fetchSports } from "../api";
import { Badge } from "../components/primitives/Badge";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp } from "../time";
import { readToken } from "../token";
import type { League, SportsEvent } from "../types";

const isTop25 = (e: SportsEvent) =>
  [e.home_rank, e.away_rank].some((r) => r !== null && r >= 1 && r <= 25);

const matchup = (e: SportsEvent) => {
  const side = (name: string, rank: number | null) => (rank ? `#${rank} ${name}` : name);
  const score = e.home_score !== null && e.away_score !== null ? ` ${e.away_score}–${e.home_score}` : "";
  return `${side(e.away, e.away_rank)} at ${side(e.home, e.home_rank)}${score}`;
};

export default function Sports() {
  const token = readToken();
  const { data, loading, refreshing, error, reload } = useAsyncData(
    useCallback((force: boolean) => fetchSports(token, force), [token]),
  );
  const [topOnly, setTopOnly] = useState(false);

  const columns: Column<SportsEvent>[] = [
    {
      key: "game",
      header: "Game",
      sortValue: (e) => e.start_at,
      render: (e) =>
        e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{matchup(e)}</a> : matchup(e),
    },
    { key: "league", header: "League", sortValue: (e) => e.league, render: (e) => <Badge tone="info">{e.league}</Badge> },
    { key: "conf", header: "Conference", sortValue: (e) => e.home_conference ?? "", render: (e) => e.home_conference ?? e.away_conference ?? "—" },
    { key: "status", header: "Status", sortValue: (e) => e.status, render: (e) => e.status },
    { key: "start", header: "Start", sortValue: (e) => e.start_at, render: (e) => centralTimestamp(e.start_at) },
  ];

  const rows = (data?.events ?? []).filter((e) => !topOnly || isTop25(e));
  const rankings = data?.rankings;

  return (
    <>
      <PageHeader
        title="Sports"
        description="Bears, Bulls, White Sox, Northwestern and Temple first, then league and college schedules. Rankings are shown only from a current poll."
        lastUpdated={data?.freshness_at ? centralTimestamp(data.freshness_at) : undefined}
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing || !token}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view sports." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <RefreshOverlay refreshing={refreshing} label="Refreshing sports">
          <LoadingBoundary
            loading={loading}
            hasData={Boolean(data)}
            label="Loading sports"
            skeleton={<SkeletonStack rows={6} rowHeight={52} />}
            empty={<EmptyState message="No sports data is available." />}
          >
            {data && (
              <>
                {!data.configured && (
                  <p role="status" className="muted">
                    No sports data provider is configured, so scores are not available. Official scoreboards:{" "}
                    {(Object.keys(data.official_links) as League[]).map((l, i) => (
                      <span key={l}>
                        {i > 0 && " · "}
                        <a href={data.official_links[l]} target="_blank" rel="noopener noreferrer">{l}</a>
                      </span>
                    ))}
                  </p>
                )}
                {data.configured && data.last_error && (
                  <p role="status" className="muted">Showing last saved games; the latest refresh failed.</p>
                )}
                {data.priority.length > 0 && (
                  <ul aria-label="Chicago teams">
                    {data.priority.map((e) => <li key={e.id}>{matchup(e)} · {centralTimestamp(e.start_at)}</li>)}
                  </ul>
                )}
                <label>
                  <input type="checkbox" checked={topOnly} disabled={!rankings?.current} onChange={(ev) => setTopOnly(ev.target.checked)} />{" "}
                  AP Top 25 only
                </label>
                {rankings?.current ? (
                  <span className="muted"> Poll of {rankings.poll_date}</span>
                ) : (
                  <span className="muted"> Rankings unavailable{rankings?.poll_date ? ` (last poll ${rankings.poll_date} is out of date)` : ""}</span>
                )}
                <Table
                  columns={columns}
                  rows={rows}
                  rowKey={(e) => e.id}
                  searchText={(e) => `${e.home} ${e.away} ${e.league}`}
                  filters={[
                    { label: "League", value: (e) => e.league },
                    { label: "Conference", value: (e) => e.home_conference ?? e.away_conference ?? "" },
                  ]}
                  emptyMessage="No games match."
                />
              </>
            )}
          </LoadingBoundary>
        </RefreshOverlay>
      )}
    </>
  );
}
