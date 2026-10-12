import { useCallback } from "react";

import { fetchDeployments } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { readToken } from "../../token";
import type { FlyRelease } from "../../types";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { StatusDot } from "../primitives/StatusDot";
import { Table, type Column } from "../primitives/Table";
import { centralTimestamp } from "../../time";

const when = centralTimestamp;

const columns: Column<FlyRelease>[] = [
  { key: "version", header: "Version", align: "right", sortValue: (r) => r.version, render: (r) => `v${r.version}` },
  {
    key: "status",
    header: "Status",
    sortValue: (r) => r.status,
    render: (r) => (
      <>
        <StatusDot tone={r.status === "complete" ? "success" : r.status === "failed" ? "error" : "warning"} label={r.status} /> {r.status}
      </>
    ),
  },
  { key: "when", header: "Deployed", sortValue: (r) => r.createdAt, render: (r) => when(r.createdAt) },
  { key: "what", header: "Description", render: (r) => r.reason || r.description || "—" },
  { key: "image", header: "Image", render: (r) => <code>{r.imageRef.split(":").pop()}</code> },
];

export function DeploymentsTab({ appId }: { appId: string }) {
  const token = readToken();
  const { data, loading, error, reload } = useAsyncData(useCallback(() => fetchDeployments(appId, token), [appId, token]));

  if (!token) return <EmptyState message="Add your dashboard token in Settings to view deployments." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (loading || !data) return null;
  if (!data.fly_app) return <EmptyState message="This app is not hosted on Fly, or has no Fly app configured." />;
  return (
    <>
      <div className="ui-stat-label" style={{ marginBottom: 8 }}>Releases of {data.fly_app}</div>
      <Table columns={columns} rows={data.releases} rowKey={(r) => String(r.version)} emptyMessage="No releases." />
    </>
  );
}
