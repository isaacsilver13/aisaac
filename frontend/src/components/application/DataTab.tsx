import { useCallback, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchDashboard, fetchMetricsHistory } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { HistoryRange } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Stat } from "../primitives/Stat";
import { Table, type Column } from "../primitives/Table";
import { centralTimestamp, exactTimestamp, humanizeTimestamp } from "../../time";

type Metric = { key: string; value: string };

const RANGES: HistoryRange[] = ["24h", "7d", "30d"];
const when = centralTimestamp;

const columns: Column<Metric>[] = [
  { key: "key", header: "Metric", sortValue: (m) => m.key, render: (m) => m.key },
  { key: "value", header: "Value", align: "right", sortValue: (m) => m.value, render: (m) => m.value },
];

function MetricChart({ name, points }: { name: string; points: { t: string; value: number }[] }) {
  return (
    <Card>
      <div className="ui-stat-label" style={{ marginBottom: 8 }}>{name}</div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip
              labelFormatter={(t) => when(String(t))}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--text)" }}
            />
            <Line type="monotone" dataKey="value" name={name} stroke="var(--info)" strokeWidth={1.5} dot={points.length === 1} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** Data the app itself reports (allowlisted per app in the registry), with history for numeric metrics. */
export function DataTab({ appId }: { appId: string }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const { data, loading, error, reload } = useAsyncData(fetchDashboard);
  const history = useAsyncData(useCallback(() => fetchMetricsHistory(appId, range), [appId, range]));

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  const result = data?.results.find((r) => r.app_id === appId);
  if (!loading && !result) return <EmptyState message="This application is not registered." />;
  if (!result) return null;

  const rows: Metric[] = Object.entries(result.metrics).map(([key, value]) => ({ key, value: String(value) }));
  const series = Object.entries(history.data?.series ?? {});

  return (
    <>
      <Card>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <Stat
            label="Freshness"
            value={result.freshness ? <time dateTime={result.freshness} title={exactTimestamp(result.freshness)}>{humanizeTimestamp(result.freshness)}</time> : "—"}
          />
          <Stat label="Metrics" value={result.metrics_state ?? "—"} />
          <Stat label="Provider" value={result.provider_state ?? "—"} />
          <Stat label="Reported" value={when(result.checked_at)} />
        </div>
      </Card>
      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Reported metrics</div>
      <Table columns={columns} rows={rows} rowKey={(m) => m.key} searchText={(m) => m.key} emptyMessage="This app reports no metrics." />

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>History</div>
      <div className="tab-row" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} className={`tab-link${r === range ? " tab-link-active" : ""}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
      </div>
      {history.error ? (
        <ErrorState message={history.error} onRetry={() => void history.reload()} />
      ) : series.length === 0 ? (
        !history.loading && <EmptyState message="No numeric metric history in this range. It accrues while the dashboard is open." />
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {series.map(([name, points]) => <MetricChart key={name} name={name} points={points} />)}
        </div>
      )}
    </>
  );
}
