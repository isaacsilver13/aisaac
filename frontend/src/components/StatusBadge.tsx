import { CheckCircle, Circle, XmarkCircle, Clock, Hourglass, WarningTriangle } from "iconoir-react";
import { AnimatePresence, motion } from "motion/react";

import type { HealthState } from "../types";
import { motionDuration, motionEase } from "../theme/motion";

const statusConfig: Record<HealthState, { label: string; className: string; Icon: typeof CheckCircle }> = {
  up: { label: "Operational", className: "status-up", Icon: CheckCircle },
  slow: { label: "Slow / waking up", className: "status-slow", Icon: Hourglass },
  degraded: { label: "Degraded", className: "status-degraded", Icon: WarningTriangle },
  down: { label: "Down", className: "status-down", Icon: XmarkCircle },
  unavailable: { label: "Not configured", className: "status-unavailable", Icon: Circle },
  stale: { label: "No recent heartbeat", className: "status-stale", Icon: Clock },
};

interface StatusBadgeProps {
  state: HealthState;
  compact?: boolean;
}

export function StatusBadge({ state, compact = false }: StatusBadgeProps) {
  const config = statusConfig[state];
  return (
    <span className="status-badge-shell" aria-live="polite">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={state}
          className={`status-badge ${config.className}${compact ? " status-badge-compact" : ""}`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: motionDuration.fast, ease: motionEase }}
        >
          <config.Icon width={compact ? 14 : 16} height={compact ? 14 : 16} aria-hidden="true" />
          <span>{config.label}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
