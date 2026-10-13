import { useCallback } from "react";
import { Refresh, Server } from "iconoir-react";
import { AnimatePresence, motion } from "motion/react";

import { fetchDashboard, fetchIncidents } from "../api";
import { AppCard } from "../components/AppCard";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { FinancialsPanel } from "../components/dashboard/FinancialsPanel";
import { LifePanel } from "../components/dashboard/LifePanel";
import { SecondBrainPanel } from "../components/dashboard/SecondBrainPanel";
import { SystemOverview } from "../components/dashboard/SystemOverview";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { Skeleton } from "../components/primitives/Skeleton";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp } from "../time";
import type { DashboardResponse, HealthState, Incident } from "../types";
import { layoutSpring, motionDuration, motionEase, pressTransition } from "../theme/motion";

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
  const orderedResults = stateOrder.flatMap((state) => results.filter((result) => result.state === state));

  return (
    <>
      <PageHeader
        title="Everything at a Glance"
        description="A quiet pulse check for the apps that keep the week moving."
        lastUpdated={dashboard ? centralTimestamp(dashboard.refreshed_at) : undefined}
        actions={
          <motion.button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing} whileTap={{ scale: 0.97 }} transition={pressTransition}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Checking" : "Refresh"}</span>
          </motion.button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void reload(true)} retrying={refreshing} />
      ) : (
        <LoadingBoundary
          loading={loading}
          hasData
          label="Loading system overview"
          skeleton={
            <div className="dashboard-top-row">
              <Skeleton height={150} />
              <Skeleton height={150} />
            </div>
          }
          empty={null}
        >
          <div className="dashboard-top-row">
            <SystemOverview
              results={results}
              openIncidents={openIncidents}
              loading={false}
              lastChecked={dashboard ? centralTimestamp(dashboard.refreshed_at) : undefined}
            />
            <LifePanel />
          </div>
        </LoadingBoundary>
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
        <RefreshOverlay refreshing={refreshing}>
          <LoadingBoundary
            loading={loading}
            hasData={orderedResults.length > 0}
            label="Loading application statuses"
            skeleton={
              <div className="app-grid" aria-hidden="true">
                {[1, 2, 3, 4].map((item) => <Skeleton height={260} key={item} />)}
              </div>
            }
            empty={<EmptyState message="No applications are configured for this profile." />}
          >
            <motion.div className="app-grid" layout>
              <AnimatePresence mode="popLayout">
                {orderedResults.map((result, index) => (
                  <motion.div
                    className="app-card-layout"
                    key={result.app_id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    whileHover={{ y: -2 }}
                    transition={{
                      layout: layoutSpring,
                      opacity: { duration: motionDuration.standard, delay: Math.min(index * 0.03, 0.15) },
                      y: { duration: motionDuration.standard, ease: motionEase },
                    }}
                  >
                    <AppCard
                      result={result}
                      openIncident={openIncidentsByApp.get(result.app_id)}
                      onIncidentResolved={reloadQuietly}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </LoadingBoundary>
        </RefreshOverlay>
      </section>

      {!loading && results.length > 0 && (
        <div className="activity-feed-section">
          <ActivityFeed results={results} />
        </div>
      )}
    </>
  );
}
