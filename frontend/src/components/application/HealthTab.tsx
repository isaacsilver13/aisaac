import { useCallback, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchHealthHistory, fetchIncidents } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { HistoryRange, Incident } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { LoadingBoundary } from "../primitives/LoadingBoundary";
import { Skeleton, SkeletonStack } from "../primitives/Skeleton";
import { Stat } from "../primitives/Stat";
import { StatusDot } from "../primitives/StatusDot";
import { Table, type Column } from "../primitives/Table";
import { centralTimestamp } from "../../time";
import { STATE_TONE } from "../primitives/tone";

const RANGES: HistoryRange[] = ["24h", "7d", "30d"];

const ms = (v: number | null) => (v === null ? "—" : `${Math.round(v)} ms`);
const when = centralTimestamp;

const incidentColumns: Column<Incident>[] = [
  { key: "started", header: "Started", sortValue: (i) => i.started_at, render: (i) => when(i.started_at) },
  { key: "type", header: "Type", sortValue: (i) => i.failure_type, render: (i) => i.failure_type },
  {
    key: "status",
    header: "Status",
    sortValue: (i) => (i.resolved_at ? 1 : 0),
    render: (i) => (i.resolved_at ? `Resolved ${when(i.resolved_at)}` : "Open"),
  },
  { key: "notes", header: "Notes", render: (i) => i.notes ?? "—" },
];

function HealthHistory({ appId, range }: { appId: string; range: HistoryRange }) {
  const history = useAsyncData(useCallback(() => fetchHealthHistory(appId, range), [appId, range]));
  const summary = history.data?.summary;
  const points = history.data?.points ?? [];

  if (history.error) return <ErrorState message={history.error} onRetry={() => void history.reload()} />;

  return (
    <LoadingBoundary
      loading={history.loading}
      hasData={Boolean(history.data)}
      label={`Loading ${range} health history`}
      skeleton={<><Skeleton height={112} /><div style={{ height: 12 }} /><Skeleton height={250} /></>}
      empty={<EmptyState message="No health history is available." />}
    >
      <>
        <Card>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <Stat label="Uptime" value={summary?.uptime_pct == null ? "—" : `${summary.uptime_pct}%`} />
            <Stat label="Avg response" value={ms(summary?.avg_response_ms ?? null)} />
            <Stat label="p95 response" value={ms(summary?.p95_response_ms ?? null)} />
            <Stat label="Checks" value={summary?.checks ?? "—"} />
            <Stat
              label="Last state"
              value={summary?.last_state ? <><StatusDot tone={STATE_TONE[summary.last_state]} label={summary.last_state} /> {summary.last_state}</> : "—"}
            />
          </div>
        </Card>

        <Card>
          <div className="ui-stat-label" style={{ marginBottom: 12 }}>Response time</div>
          {points.length === 0 ? (
            <EmptyState message="No checks recorded in this range. History accrues while the dashboard is open." />
          ) : (
            <>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="t" tickFormatter={(t: string) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={32} />
                    <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} unit=" ms" />
                    <Tooltip
                      labelFormatter={(t) => when(String(t))}
                      formatter={(v) => [ms(Number(v)), "Response"]}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: "var(--text)" }}
                    />
                    <Line type="monotone" dataKey="response_ms" stroke="var(--info)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", gap: 1, marginTop: 8 }} aria-label="State over time">
                {points.map((p) => (
                  <span
                    key={p.t}
                    title={`${when(p.t)} — ${p.state}`}
                    style={{ background: `var(--${STATE_TONE[p.state]})`, flex: 1, height: 8, minWidth: 1 }}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      </>
    </LoadingBoundary>
  );
}

export function HealthTab({ appId }: { appId: string }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const incidents = useAsyncData(useCallback(() => fetchIncidents(), []));
  const mine = (incidents.data ?? []).filter((i) => i.app_id === appId);

  return (
    <>
      <div className="tab-row" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} className={`tab-link${r === range ? " tab-link-active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
      </div>

      <HealthHistory key={range} appId={appId} range={range} />

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Incidents</div>
      <LoadingBoundary
        loading={incidents.loading}
        hasData={Boolean(incidents.data)}
        label="Loading incidents"
        skeleton={<SkeletonStack rows={4} rowHeight={44} />}
        empty={<EmptyState message="No incident data is available." />}
      >
        <Table columns={incidentColumns} rows={mine} rowKey={(i) => String(i.id)} emptyMessage="No incidents for this app." />
      </LoadingBoundary>
    </>
  );
}
