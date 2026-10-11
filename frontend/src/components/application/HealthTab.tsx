import { useCallback, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchHealthHistory, fetchIncidents } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { HistoryRange, Incident } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
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

export function HealthTab({ appId }: { appId: string }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const history = useAsyncData(useCallback(() => fetchHealthHistory(appId, range), [appId, range]));
  const incidents = useAsyncData(() => fetchIncidents());

  const summary = history.data?.summary;
  const points = history.data?.points ?? [];
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

      {history.error ? (
        <ErrorState message={history.error} onRetry={() => void history.reload()} />
      ) : (
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
            {!history.loading && points.length === 0 ? (
              <EmptyState message="No checks recorded in this range. History accrues while the dashboard is open." />
            ) : (
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
            )}
            {points.length > 0 && (
              <div style={{ display: "flex", gap: 1, marginTop: 8 }} aria-label="State over time">
                {points.map((p) => (
                  <span
                    key={p.t}
                    title={`${when(p.t)} — ${p.state}`}
                    style={{ background: `var(--${STATE_TONE[p.state]})`, flex: 1, height: 8, minWidth: 1 }}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Incidents</div>
      <Table columns={incidentColumns} rows={mine} rowKey={(i) => String(i.id)} emptyMessage="No incidents for this app." />
    </>
  );
}
