import { Link } from "react-router-dom";
import { ArrowUpRight } from "iconoir-react";

import { fetchApps, fetchDashboard, fetchDeployments, fetchHealthHistory } from "../api";
import { AppIcon } from "../components/application/AppIcon";
import { ErrorState } from "../components/primitives/ErrorState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Table, type Column } from "../components/primitives/Table";
import { StatusBadge } from "../components/StatusBadge";
import { useAsyncData } from "../hooks/useAsyncData";
import { exactTimestamp, humanizeTimestamp } from "../time";
import { readToken } from "../token";
import type { AppInfo, CheckResult, FlyRelease, HealthState } from "../types";

interface Row {
  app: AppInfo;
  result: CheckResult | undefined;
  uptime: number | null;
  responses: number[];
  release: FlyRelease | null;
}

// Worst first, so an ascending sort surfaces trouble.
const SEVERITY: HealthState[] = ["down", "degraded", "stale", "slow", "up", "unavailable"];

/** One request per app for history/deploys; failures there blank a cell, not the page. */
async function loadRows(): Promise<Row[]> {
  const token = readToken();
  const [apps, dashboard] = await Promise.all([fetchApps(), fetchDashboard()]);
  return Promise.all(
    apps.map(async (app) => {
      const [history, deploys] = await Promise.allSettled([
        fetchHealthHistory(app.id, "24h"),
        token && app.fly_app ? fetchDeployments(app.id, token) : Promise.resolve(null),
      ]);
      const h = history.status === "fulfilled" ? history.value : null;
      return {
        app,
        result: dashboard.results.find((r) => r.app_id === app.id),
        uptime: h?.summary.uptime_pct ?? null,
        responses: (h?.points ?? []).flatMap((p) => (p.response_ms === null ? [] : [p.response_ms])),
        release: deploys.status === "fulfilled" ? (deploys.value?.releases[0] ?? null) : null,
      };
    }),
  );
}

function stackSummary(app: AppInfo): string {
  return (app.stack?.nodes ?? []).map((n) => n.tech.split(" · ")[0]).join(" → ") || "—";
}

function hostSummary(app: AppInfo): string {
  const hosts = [...new Set((app.stack?.nodes ?? []).filter((n) => n.kind !== "database" && n.kind !== "provider" && n.host).map((n) => n.host))];
  if (hosts.length === 0) return "—";
  return app.stack?.region ? `Fly · ${hosts.join(", ")} · ${app.stack.region}` : hosts.join(", ");
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="ui-stat-label">—</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - min) / span) * 20}`).join(" ");
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return (
    <span className="app-trend">
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={`Response time, average ${avg} ms`}>
        <polyline points={points} fill="none" stroke="var(--info)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span>{avg} ms</span>
    </span>
  );
}

const columns: Column<Row>[] = [
  {
    key: "app",
    header: "Application",
    sortValue: (r) => r.app.name,
    render: (r) => (
      <Link to={`/applications/${r.app.id}/overview`} className="app-name-cell">
        <AppIcon appId={r.app.id} size={18} />
        <span>
          <strong>{r.app.name}</strong>
          <small>{r.app.category}</small>
        </span>
      </Link>
    ),
  },
  {
    key: "health",
    header: "Health",
    sortValue: (r) => (r.result ? SEVERITY.indexOf(r.result.state) : null),
    render: (r) => (r.result ? <StatusBadge state={r.result.state} compact /> : "—"),
  },
  { key: "stack", header: "Stack", sortValue: (r) => stackSummary(r.app), render: (r) => stackSummary(r.app) },
  { key: "host", header: "Host", sortValue: (r) => hostSummary(r.app), render: (r) => hostSummary(r.app) },
  {
    key: "deploy",
    header: "Last deploy",
    sortValue: (r) => r.release?.createdAt ?? null,
    render: (r) =>
      r.release ? (
        <time dateTime={r.release.createdAt} title={exactTimestamp(r.release.createdAt)}>
          v{r.release.version} · {humanizeTimestamp(r.release.createdAt)}
        </time>
      ) : (
        "—"
      ),
  },
  {
    key: "uptime",
    header: "Uptime 24h",
    align: "right",
    sortValue: (r) => r.uptime,
    render: (r) => (r.uptime === null ? "—" : `${r.uptime}%`),
  },
  { key: "trend", header: "Response 24h", render: (r) => <Sparkline values={r.responses} /> },
  {
    key: "links",
    header: "Links",
    render: (r) => (
      <span className="app-links">
        {r.app.product_url && (
          <a href={r.app.product_url} target="_blank" rel="noreferrer">
            Open <ArrowUpRight width={12} height={12} aria-hidden="true" />
          </a>
        )}
        <Link to={`/applications/${r.app.id}/stack`}>Stack</Link>
        <Link to={`/applications/${r.app.id}/health`}>Health</Link>
        {r.app.fly_app && <Link to={`/applications/${r.app.id}/deployments`}>Deploys</Link>}
      </span>
    ),
  },
];

export default function Applications() {
  const { data, loading, error, reload } = useAsyncData(loadRows);

  return (
    <>
      <PageHeader
        title="Applications"
        description={readToken() ? undefined : "Add your dashboard token in Settings to see last deploys."}
      />
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <Table
          columns={columns}
          rows={data ?? []}
          rowKey={(r) => r.app.id}
          searchText={(r) => `${r.app.name} ${r.app.category} ${stackSummary(r.app)}`}
          filters={[
            { label: "Category", value: (r) => r.app.category },
            { label: "Health", value: (r) => r.result?.state ?? "unknown" },
          ]}
          emptyMessage={loading ? "Loading…" : "No applications registered."}
        />
      )}
    </>
  );
}
