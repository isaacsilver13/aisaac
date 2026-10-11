import { useCallback } from "react";

import { fetchLogs } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { readToken } from "../../token";
import type { LogLine } from "../../types";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Table, type Column } from "../primitives/Table";
import { centralTimestampOrDash } from "../../time";

const time = centralTimestampOrDash;

const columns: Column<LogLine>[] = [
  { key: "time", header: "Time", sortValue: (l) => l.timestamp, render: (l) => time(l.timestamp) },
  { key: "level", header: "Level", sortValue: (l) => l.level, render: (l) => l.level ?? "—" },
  { key: "message", header: "Message", render: (l) => <code style={{ whiteSpace: "pre-wrap" }}>{l.message}</code> },
];

export function LogsTab({ appId }: { appId: string }) {
  const token = readToken();
  const { data, loading, refreshing, error, reload } = useAsyncData(useCallback(() => fetchLogs(appId, token), [appId, token]));

  if (!token) return <EmptyState message="Add your dashboard token in Settings to view logs." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (loading || !data) return null;
  if (!data.fly_app) return <EmptyState message="This app is not hosted on Fly, or has no Fly app configured." />;
  return (
    <>
      <div className="ui-stat-label" style={{ alignItems: "center", display: "flex", gap: 12, marginBottom: 8 }}>
        <span>Recent logs of {data.fly_app} (latest lines Fly retains)</span>
        <button type="button" onClick={() => void reload(true)} disabled={refreshing}>Refresh</button>
      </div>
      <Table
        columns={columns}
        rows={[...data.lines].reverse()}
        rowKey={(l) => `${l.timestamp}-${l.instance}-${l.message}`}
        searchText={(l) => l.message ?? ""}
        filters={[{ label: "Level", value: (l) => l.level ?? "unknown" }]}
        emptyMessage="No recent log lines."
      />
    </>
  );
}
