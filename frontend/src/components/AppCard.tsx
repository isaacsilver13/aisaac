import { useState } from "react";
import { ArrowUpRight, Book, Check, Clock, Timer, Antenna, ShieldCheck } from "iconoir-react";

import { fetchRunbook, resolveIncident } from "../api";
import { centralTimestamp } from "../time";
import type { CheckResult, Incident } from "../types";
import { Card } from "./primitives/Card";
import { StatusBadge } from "./StatusBadge";

interface AppCardProps {
  result: CheckResult;
  index: number;
  openIncident?: Incident;
  onIncidentResolved?: () => void;
}

const formatCheckedAt = centralTimestamp;

function formatMetric(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function AppCard({ result, index, openIncident, onIncidentResolved }: AppCardProps) {
  const metricEntries = Object.entries(result.metrics).slice(0, 3);
  const [runbook, setRunbook] = useState<string | null | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function handleViewRunbook() {
    if (runbook !== undefined) {
      setRunbook(undefined);
      return;
    }
    setRunbook(await fetchRunbook(result.app_id));
  }

  async function handleResolve() {
    if (!openIncident) return;
    setResolving(true);
    try {
      setResolveError(null);
      await resolveIncident(openIncident.id, "Resolved from AIsaac dashboard.");
      onIncidentResolved?.();
    } catch {
      setResolveError("Could not resolve: set the dashboard write token in Settings.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <Card
      id={`app-${result.app_id}`}
      className={`app-card state-${result.state}`}
      style={{ "--card-index": index } as React.CSSProperties}
    >
      <div className="card-topline">
        <span className="card-category">{result.category}</span>
        <StatusBadge state={result.state} compact />
      </div>
      <div className="card-heading">
        <div>
          <h2>{result.name}</h2>
          <p>{result.description}</p>
        </div>
        {result.product_url ? (
          <a className="launch-button" href={result.product_url} target="_blank" rel="noreferrer" aria-label={`Open ${result.name}`}>
            <ArrowUpRight width={18} height={18} aria-hidden="true" />
          </a>
        ) : (
          <span className="launch-button launch-button-disabled" aria-hidden="true">
            <ArrowUpRight width={18} height={18} />
          </span>
        )}
      </div>
      <div className="card-rule" />
      <div className="card-facts">
        <div className="fact">
          <Clock width={15} height={15} aria-hidden="true" />
          <span>Checked {formatCheckedAt(result.checked_at)}</span>
        </div>
        <div className="fact">
          <Timer width={15} height={15} aria-hidden="true" />
          <span>{result.response_ms === null ? "No response" : `${result.response_ms} ms`}</span>
        </div>
        {result.readiness && (
          <div className="fact">
            <ShieldCheck width={15} height={15} aria-hidden="true" />
            <span>Readiness {result.readiness}</span>
          </div>
        )}
        {result.page_state && (
          <div className="fact">
            <Antenna width={15} height={15} aria-hidden="true" />
            <span>Page {result.page_state}</span>
          </div>
        )}
        {result.metrics_state && (
          <div className="fact">
            <Timer width={15} height={15} aria-hidden="true" />
            <span>Metrics {result.metrics_state}</span>
          </div>
        )}
        {result.provider_state && (
          <div className="fact">
            <Antenna width={15} height={15} aria-hidden="true" />
            <span>Provider {result.provider_state}</span>
          </div>
        )}
      </div>
      {result.detail && <p className="card-detail">{result.detail}</p>}
      {openIncident && (
        <div className="incident-banner">
          <div className="incident-banner-row">
            <span>Open incident since {formatCheckedAt(openIncident.started_at)}</span>
            <div className="incident-actions">
              <button type="button" className="link-button" onClick={() => void handleViewRunbook()}>
                <Book width={14} height={14} aria-hidden="true" />
                {runbook !== undefined ? "Hide runbook" : "View runbook"}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => void handleResolve()}
                disabled={resolving}
              >
                <Check width={14} height={14} aria-hidden="true" />
                Mark resolved
              </button>
            </div>
          </div>
          {resolveError && <p role="alert">{resolveError}</p>}
          {runbook !== undefined && (
            <pre className="runbook-text">
              {runbook ?? "No runbook has been written for this app yet."}
            </pre>
          )}
        </div>
      )}
      {metricEntries.length > 0 && (
        <div className="metric-strip">
          {metricEntries.map(([key, value]) => (
            <div className="metric" key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <strong>{formatMetric(value)}</strong>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
