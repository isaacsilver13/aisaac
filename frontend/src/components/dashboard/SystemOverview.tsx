import { CheckCircle, WarningTriangle } from "iconoir-react";

import { isOperational } from "../../health";
import { centralTimestamp } from "../../time";
import type { CheckResult, Incident } from "../../types";
import { Card } from "../primitives/Card";
import { Stat } from "../primitives/Stat";
import { StatusDot } from "../primitives/StatusDot";

interface SystemOverviewProps {
  results: CheckResult[];
  openIncidents: Incident[];
  loading: boolean;
  lastChecked?: string;
}

const legend = { display: "flex", alignItems: "center", gap: 6, fontSize: 12 } as const;
const note = { textTransform: "none", letterSpacing: 0 } as const;

/** System status and open incidents in one card. */
export function SystemOverview({ results, openIncidents, loading, lastChecked }: SystemOverviewProps) {
  const total = results.length;
  const down = results.filter((result) => result.state === "down").length;
  const degraded = results.filter((result) => result.state === "degraded").length;
  const stale = results.filter((result) => result.state === "stale").length;
  const unavailable = results.filter((result) => result.state === "unavailable").length;
  const operational = results.filter((result) => isOperational(result.state)).length;

  return (
    <Card aria-label="System status">
      <div className="ui-stat-label" style={{ marginBottom: 12 }}>System status</div>
      <Stat label="Operational" value={loading ? "--" : `${operational}/${total}`} />
      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <span style={legend}><StatusDot tone="success" label="Operational" /> {operational} operational</span>
        <span style={legend}><StatusDot tone="warning" label="Degraded" /> {degraded} degraded</span>
        <span style={legend}><StatusDot tone="error" label="Down" /> {down} down</span>
        <span style={legend}><StatusDot tone="warning" label="Stale" /> {stale} stale</span>
        <span style={legend}><StatusDot tone="neutral" label="Unavailable" /> {unavailable} unavailable</span>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
        {openIncidents.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle width={16} height={16} style={{ color: "var(--success)" }} aria-hidden="true" />
            <strong style={{ fontSize: 13 }}>No active incidents</strong>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <WarningTriangle width={16} height={16} style={{ color: "var(--warning)" }} aria-hidden="true" />
              <strong style={{ fontSize: 13 }}>Attention required</strong>
            </div>
            <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
              {openIncidents.map((incident) => {
                const app = results.find((result) => result.app_id === incident.app_id);
                return (
                  <li key={incident.id}>
                    <a href={`#app-${incident.app_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                      <strong style={{ fontSize: 13 }}>{app?.name ?? incident.app_id}</strong>
                    </a>
                    <div className="ui-stat-label" style={{ ...note, marginTop: 2 }}>
                      {incident.failure_type} · since {centralTimestamp(incident.started_at)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {lastChecked && <div className="ui-stat-label" style={{ marginTop: 14 }}>Last checked {lastChecked}</div>}
    </Card>
  );
}
