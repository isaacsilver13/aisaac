import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAutomationRuns, fetchAutomations } from "../api";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SectionHeader } from "../components/primitives/SectionHeader";
import { Stat } from "../components/primitives/Stat";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { StatusDot } from "../components/primitives/StatusDot";
import { Table, type Column } from "../components/primitives/Table";
import type { Tone } from "../components/primitives/tone";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestampOrDash } from "../time";
import { readToken } from "../token";
import type { AutomationRun, AutomationStatus } from "../types";

const TONE: Record<AutomationStatus["status"], Tone> = { ok: "success", stale: "warning", failing: "error", never: "error", disabled: "neutral" };
const SUMMARY: AutomationStatus["status"][] = ["ok", "stale", "failing", "never"];
const when = centralTimestampOrDash;
const selectButton = { background: "none", border: 0, color: "var(--accent)", cursor: "pointer", font: "inherit", padding: 0, textAlign: "left" } as const;
const hours = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);

function columns(select: (a: AutomationStatus) => void): Column<AutomationStatus>[] {
  return [
    {
      key: "name",
      header: "Automation",
      sortValue: (a) => a.name,
      render: (a) => <button type="button" style={selectButton} onClick={() => select(a)}>{a.name}</button>,
    },
    { key: "kind", header: "Kind", sortValue: (a) => a.kind, render: (a) => a.kind },
    { key: "last", header: "Last run", sortValue: (a) => a.last_run_at, render: (a) => when(a.last_run_at) },
    { key: "expected", header: "Every", align: "right", sortValue: (a) => a.expected_hours, render: (a) => (a.expected_hours === null ? "—" : hours(a.expected_hours)) },
    { key: "next", header: "Next expected", sortValue: (a) => a.next_expected_at, render: (a) => when(a.next_expected_at) },
    {
      key: "overdue",
      header: "Overdue",
      align: "right",
      sortValue: (a) => a.overdue_hours,
      render: (a) => (a.overdue_hours ? hours(a.overdue_hours) : "—"),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (a) => a.status,
      render: (a) => (<><StatusDot tone={TONE[a.status]} label={a.status} /> {a.status}</>),
    },
    {
      key: "error",
      header: "Last failure",
      sortValue: (a) => a.last_error_at,
      render: (a) => (a.last_error ? <span title={when(a.last_error_at)}>{a.last_error}</span> : "—"),
    },
    { key: "detail", header: "Source", render: (a) => a.detail },
  ];
}

const runColumns: Column<AutomationRun>[] = [
  { key: "at", header: "When", sortValue: (r) => r.ran_at, render: (r) => when(r.ran_at) },
  {
    key: "ok",
    header: "Result",
    sortValue: (r) => (r.ok ? 1 : 0),
    render: (r) => (<><StatusDot tone={r.ok ? "success" : "error"} label={r.ok ? "ok" : "failed"} /> {r.ok ? "ok" : "failed"}</>),
  },
  { key: "detail", header: "Detail", render: (r) => r.detail || "—" },
];

function RunHistory({ token, automation }: { token: string; automation: AutomationStatus }) {
  const { data, loading, error, reload } = useAsyncData(
    useCallback(() => fetchAutomationRuns(token, automation.id), [token, automation.id]),
  );
  const oldestFirst = [...(data ?? [])].reverse();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);
  return (
    <section ref={ref} style={{ marginTop: 24 }}>
      <SectionHeader title={`${automation.name}: recent runs`} description="Newest last on the timeline; up to 30 runs over the last 30 days." />
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <LoadingBoundary
          loading={loading}
          hasData={oldestFirst.length > 0}
          label={`Loading ${automation.name} runs`}
          skeleton={<SkeletonStack rows={4} rowHeight={42} />}
          empty={<EmptyState message={automation.kind === "poller" ? "The health poller keeps no run log; see each app's Health tab." : "No runs recorded yet."} />}
        >
          <>
            <div role="list" aria-label="Run timeline" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 16px" }}>
              {oldestFirst.map((r, i) => (
                <span role="listitem" key={`${r.ran_at}-${i}`} title={`${when(r.ran_at)}${r.detail ? ` · ${r.detail}` : ""}`}>
                  <StatusDot tone={r.ok ? "success" : "error"} label={`${when(r.ran_at)} ${r.ok ? "ok" : "failed"}`} />
                </span>
              ))}
            </div>
            <Table columns={runColumns} rows={data ?? []} rowKey={(r) => r.ran_at + r.detail} />
          </>
        </LoadingBoundary>
      )}
    </section>
  );
}

export default function Automations() {
  const token = readToken();
  const { data, loading, error, reload } = useAsyncData(useCallback(() => fetchAutomations(token), [token]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <PageHeader title="Automations" description="Last report from each push job and background task. The dashboard observes these; it does not schedule them. Select one to see its run history." />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view automations." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <LoadingBoundary
          loading={loading}
          hasData={Boolean(data)}
          label="Loading automations"
          skeleton={<SkeletonStack rows={6} rowHeight={46} />}
          empty={<EmptyState message="No automation data is available." />}
        >
          {data && <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                {SUMMARY.map((s) => (
                  <Stat key={s} label={s} value={<><StatusDot tone={TONE[s]} label={s} /> {data.filter((a) => a.status === s).length}</>} />
                ))}
              </div>
            </Card>
            <Table
              columns={columns((a) => setSelectedId(a.id))}
              rows={data}
              rowKey={(a) => a.id}
              searchText={(a) => `${a.name} ${a.detail} ${a.last_error ?? ""}`}
              filters={[{ label: "Status", value: (a) => a.status }, { label: "Kind", value: (a) => a.kind }]}
            />
            {selected && <RunHistory key={selected.id} token={token} automation={selected} />}
          </>}
        </LoadingBoundary>
      )}
    </>
  );
}
