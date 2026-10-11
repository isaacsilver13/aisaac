import { useEffect, useState, type FormEvent } from "react";

import { FinancialsAuthError, fetchFinancials } from "../../api";
import { readToken, writeToken } from "../../token";
import type { ClaudeUsage, CodexUsage, FinancialSnapshot, HostingCostRow, UsageWindow } from "../../types";
import { Badge } from "../primitives/Badge";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { Skeleton } from "../primitives/Skeleton";
import { Stat } from "../primitives/Stat";
import { Table, type Column } from "../primitives/Table";
import {
  COST_STALE_MS,
  USAGE_STALE_MS,
  formatHours,
  formatResetAt,
  formatTimeUntil,
  formatUsd,
  isStale,
  usageTone,
} from "./financials";

function UsageRow({ label, window: win }: { label: string; window: UsageWindow }) {
  const tone = usageTone(win.used_pct);
  return (
    <li className="ai-usage-row">
      <span>{label}</span>
      <div
        className={`usage-meter usage-meter-${tone}`}
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuenow={Math.round(win.used_pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${Math.min(100, win.used_pct)}%` }} />
      </div>
      <span className="ai-usage-num">{`${win.used_pct.toFixed(0)}%`}</span>
      <span className="ai-usage-num ai-usage-reset" title={`Resets ${formatResetAt(win.resets_at)}`}>
        {formatTimeUntil(win.resets_at)}
      </span>
    </li>
  );
}

function NotReportingRow({ label }: { label: string }) {
  return (
    <li className="ai-usage-row">
      <span>{label}</span>
      <span className="ui-stat-label">Not reporting</span>
    </li>
  );
}

function AiUsageCard({ claude, codex }: { claude: ClaudeUsage | null; codex: CodexUsage | null }) {
  const stale = [
    claude && isStale(claude.reported_at, USAGE_STALE_MS) ? "Claude" : null,
    codex && isStale(codex.reported_at, USAGE_STALE_MS) ? "Codex" : null,
  ].filter(Boolean);
  return (
    <Card>
      <div className="ai-usage-head">
        <span className="ui-stat-label">AI usage</span>
        <span className="ui-stat-label">Resets in</span>
      </div>
      <ul className="ai-usage">
        {claude ? (
          <>
            <UsageRow label="Claude 5h" window={claude.session} />
            <UsageRow label="Claude 7d" window={claude.weekly} />
          </>
        ) : (
          <NotReportingRow label="Claude" />
        )}
        {codex ? (
          <>
            <UsageRow label="Codex" window={codex.primary} />
            {codex.secondary && <UsageRow label="Codex weekly" window={codex.secondary} />}
          </>
        ) : (
          <NotReportingRow label="Codex" />
        )}
      </ul>
      {stale.length > 0 && <Badge tone="warning" style={{ marginTop: 10 }}>Stale: {stale.join(", ")}</Badge>}
    </Card>
  );
}

const HOSTING_COLUMNS: Column<HostingCostRow>[] = [
  { key: "app", header: "App", render: (r) => r.name, sortValue: (r) => r.name.toLowerCase() },
  {
    key: "fly",
    header: "Fly.io",
    align: "right",
    sortValue: (r) => r.fly_usd,
    render: (r) =>
      r.fly_usd === null ? "--" : (
        <>
          {formatUsd(r.fly_usd)}
          {r.fly_hours !== null && <span className="cost-sub">{formatHours(r.fly_hours)} up</span>}
        </>
      ),
  },
  {
    key: "neon",
    header: "Neon",
    align: "right",
    sortValue: (r) => r.neon_hours,
    render: (r) =>
      r.neon_hours === null ? "--" : (
        <>
          {r.neon_usd === null ? formatHours(r.neon_hours) : formatUsd(r.neon_usd)}
          <span className="cost-sub">
            {r.neon_allowance_pct === null
              ? "compute"
              : `${formatHours(r.neon_hours)} · ${r.neon_allowance_pct.toFixed(0)}% of free`}
          </span>
        </>
      ),
  },
  { key: "total", header: "Total", align: "right", sortValue: (r) => r.total_usd, render: (r) => formatUsd(r.total_usd) },
];

function HostingCostCard({ snapshot }: { snapshot: FinancialSnapshot }) {
  const { fly, neon, hosting, hosting_total_usd: total } = snapshot;
  if (!fly && !neon) {
    return (
      <Card>
        <Stat label="Hosting costs" value="--" />
        <div className="ui-stat-label" style={{ marginTop: 10 }}>Not reporting</div>
      </Card>
    );
  }
  const stale = [fly, neon].some((source) => source && isStale(source.reported_at, COST_STALE_MS));
  const invoice = fly?.invoice_total_usd;
  const notes = [
    fly ? null : "Fly.io not reporting.",
    neon ? null : "Neon not reporting.",
    neon && (neon.free_hours_per_project ? "Neon Free plan: $0." : "Neon plan not on Free: hours only."),
    fly && invoice != null
      ? `Fly billing page says ${formatUsd(invoice)}; ${formatUsd(Math.max(0, invoice - fly.total_usd))} of that isn't app usage.`
      : null,
  ].filter(Boolean);
  return (
    <Card>
      <Stat label={`Hosting · ${fly?.period ?? neon?.period}`} value={total === null ? "--" : formatUsd(total)} />
      <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
        {fly && <Badge tone="info">Fly estimate</Badge>}
        {stale && <Badge tone="warning">Stale</Badge>}
      </div>
      <Table columns={HOSTING_COLUMNS} rows={hosting} rowKey={(r) => r.key} emptyMessage="No apps reported." />
      {notes.length > 0 && <p className="cost-notes">{notes.join(" ")}</p>}
    </Card>
  );
}

export function FinancialsPanel() {
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState("");
  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchFinancials(token)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof FinancialsAuthError) {
          writeToken("");
          setToken("");
          setError("That token was not accepted.");
        } else {
          setError(err instanceof Error ? err.message : "Could not load financial figures.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    writeToken(value);
    setToken(value);
    setDraft("");
  }

  if (!token) {
    return (
      <Card>
        <form className="token-form" onSubmit={submit}>
          <label className="ui-stat-label" htmlFor="dashboard-token">Access token for usage and costs</label>
          <input
            id="dashboard-token"
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button className="refresh-button" type="submit">Unlock</button>
          {error && <span role="alert" className="ui-stat-label">{error}</span>}
        </form>
      </Card>
    );
  }

  if (!snapshot) {
    return error ? <EmptyState message={error} /> : <Skeleton height={140} />;
  }

  return (
    <section aria-label="Usage and costs" className="financials-row">
      <AiUsageCard claude={snapshot.claude} codex={snapshot.codex} />
      <HostingCostCard snapshot={snapshot} />
    </section>
  );
}
