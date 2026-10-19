import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { isOperational } from "../../health";
import type { HealthState } from "../../types";
import { fetchDashboard } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { Tone } from "../primitives/tone";
import { MobileDrawer } from "./MobileDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { Sidebar } from "./Sidebar";
import { motionDuration, motionEase } from "../../theme/motion";

interface AppShellProps {
  children: ReactNode;
}

function summarizeSystemStatus(
  loading: boolean,
  error: string | null,
  results: { state: HealthState }[] | undefined,
): { label: string; tone: Tone } {
  if (error) return { label: "Unable to reach services", tone: "error" };
  if (loading || !results) return { label: "Checking systems…", tone: "neutral" };

  const total = results.length;
  const down = results.filter((result) => result.state === "down").length;
  const operational = results.filter((result) => isOperational(result.state)).length;

  if (down > 0) return { label: `${operational}/${total} operational`, tone: "error" };
  if (operational < total) return { label: `${operational}/${total} operational`, tone: "warning" };
  return { label: total > 0 ? `${operational}/${total} operational` : "No systems configured", tone: "success" };
}

export function AppShell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const section = useLocation().pathname.split("/")[1];
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("aisaac-sidebar") === "collapsed");
  const { data, loading, error } = useAsyncData(fetchDashboard);
  const status = summarizeSystemStatus(loading, error, data?.results);

  return (
    <div className="app-shell">
      <Sidebar
        status={status}
        apps={(data?.results ?? []).map((r) => ({ id: r.app_id, name: r.name }))}
        collapsed={collapsed}
        onToggleCollapsed={() => {
          localStorage.setItem("aisaac-sidebar", collapsed ? "expanded" : "collapsed");
          setCollapsed(!collapsed);
        }}
      />
      <MobileTopBar status={status} onOpenMenu={() => setDrawerOpen(true)} />
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        apps={(data?.results ?? []).map((r) => ({ id: r.app_id, name: r.name }))}
      />
      {/* Keyed by top-level section so tabs can manage their own local transitions. */}
      <AnimatePresence initial={false} mode="wait">
        <motion.main
          key={section}
          className="app-main"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: motionDuration.standard, ease: motionEase }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
