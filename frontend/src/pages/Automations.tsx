import { useCallback } from "react";

import { fetchAutomations } from "../api";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { PageHeader } from "../components/primitives/PageHeader";
import { StatusDot } from "../components/primitives/StatusDot";
import { Table, type Column } from "../components/primitives/Table";
import type { Tone } from "../components/primitives/tone";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestampOrDash } from "../time";
import { readToken } from "../token";
import type { AutomationStatus } from "../types";

const TONE: Record<AutomationStatus["status"], Tone> = { ok: "success", stale: "warning", never: "error", disabled: "neutral" };
const when = centralTimestampOrDash;

const columns: Column<AutomationStatus>[] = [
  { key: "name", header: "Automation", sortValue: (a) => a.name, render: (a) => a.name },
  { key: "kind", header: "Kind", sortValue: (a) => a.kind, render: (a) => a.kind },
  { key: "last", header: "Last run", sortValue: (a) => a.last_run_at, render: (a) => when(a.last_run_at) },
  { key: "expected", header: "Expected every", align: "right", sortValue: (a) => a.expected_hours, render: (a) => (a.expected_hours === null ? "—" : `${a.expected_hours} h`) },
  {
    key: "status",
    header: "Status",
    sortValue: (a) => a.status,
    render: (a) => (<><StatusDot tone={TONE[a.status]} label={a.status} /> {a.status}</>),
  },
  { key: "detail", header: "Source", render: (a) => a.detail },
];

export default function Automations() {
  const token = readToken();
  const { data, loading, error, reload } = useAsyncData(useCallback(() => fetchAutomations(token), [token]));

  return (
    <>
      <PageHeader title="Automations" description="Last report from each push job and background task. The dashboard observes these; it does not schedule them." />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view automations." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : loading || !data ? null : (
        <Table
          columns={columns}
          rows={data}
          rowKey={(a) => a.id}
          searchText={(a) => `${a.name} ${a.detail}`}
          filters={[{ label: "Status", value: (a) => a.status }, { label: "Kind", value: (a) => a.kind }]}
        />
      )}
    </>
  );
}
