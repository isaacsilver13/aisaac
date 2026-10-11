import { useCallback } from "react";
import { Refresh, Server } from "iconoir-react";

import { fetchDashboard, fetchIncidents } from "../api";
import { AppCard } from "../components/AppCard";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { FinancialsPanel } from "../components/dashboard/FinancialsPanel";
import { LifePanel } from "../components/dashboard/LifePanel";
import { SecondBrainPanel } from "../components/dashboard/SecondBrainPanel";
import { SystemOverview } from "../components/dashboard/SystemOverview";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Skeleton } from "../components/primitives/Skeleton";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp } from "../time";
import type { DashboardResponse, HealthState, Incident } from "../types";

const stateOrder: HealthState[] = ["down", "degraded", "slow", "stale", "up", "unavailable"];

interface CommandCenterData {
  dashboard: DashboardResponse;
  incidents: Incident[];
}

async function loadCommandCenterData(forceRefresh: boolean): Promise<CommandCenterData> {
  const dashboard = await fetchDashboard(forceRefresh);
  let incidents: Incident[] = [];
  try {
    incidents = await fetchIncidents();
  } catch {
    // Incident history is a bonus panel; a failure here shouldn't block
    // the core health dashboard from rendering.
  }
  return { dashboard, incidents };
}

export default function CommandCenter() {
  const { data, loading, refreshing, error, reload } = useAsyncData(loadCommandCenterData);
  const reloadQuietly = useCallback(() => void reload(false), [reload]);

  const dashboard = data?.dashboard ?? null;
  const openIncidents = (data?.incidents ?? []).filter((incident) => incident.resolved_at === null);
  const openIncidentsByApp = new Map(openIncidents.map((incident) => [incident.app_id, incident]));

  const results = dashboard?.results ?? [];

  return (
    <>
      <PageHeader
        title="Everything at a Glance"
        description="A quiet pulse check for the apps that keep the week moving."
        lastUpdated={dashboard ? centralTimestamp(dashboard.refreshed_at) : undefined}
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Checking" : "Refresh"}</span>
          </button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void reload(true)} retrying={refreshing} />
      ) : (
        <div className="dashboard-top-row">
          <SystemOverview
            results={results}
            openIncidents={openIncidents}
            loading={loading}
            lastChecked={dashboard ? centralTimestamp(dashboard.refreshed_at) : undefined}
          />
          <LifePanel />
        </div>
      )}

      <SecondBrainPanel />
      <FinancialsPanel />

      <section className="apps-section" aria-labelledby="apps-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Service registry</p>
            <h2 id="apps-heading">Your applications</h2>
          </div>
          <span className="section-index"><Server width={15} height={15} aria-hidden="true" /> {results.length.toString().padStart(2, "0")} tracked</span>
        </div>
        {loading ? (
          <div className="app-grid" aria-label="Loading application statuses">
            {[1, 2, 3, 4].map((item) => <Skeleton height={260} key={item} />)}
          </div>
        ) : results.length > 0 ? (
          <div className="app-grid">
            {stateOrder.flatMap((state) => results.filter((result) => result.state === state)).map((result, index) => (
              <AppCard
                key={result.app_id}
                result={result}
                index={index}
                openIncident={openIncidentsByApp.get(result.app_id)}
                onIncidentResolved={reloadQuietly}
              />
            ))}
          </div>
        ) : (
          <EmptyState message="No applications are configured for this profile." />
        )}
      </section>

      {!loading && results.length > 0 && (
        <div className="activity-feed-section">
          <ActivityFeed results={results} />
        </div>
      )}
    </>
  );
}
