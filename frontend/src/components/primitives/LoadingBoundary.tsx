import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { motionDuration, motionEase } from "../../theme/motion";

interface LoadingBoundaryProps {
  loading: boolean;
  hasData: boolean;
  skeleton: ReactNode;
  empty: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}

/** Keeps loading, loaded-empty, and loaded-content states visually and semantically distinct. */
export function LoadingBoundary({
  loading,
  hasData,
  skeleton,
  empty,
  children,
  className = "",
  label = "Loading content",
}: LoadingBoundaryProps) {
  const state = loading ? "loading" : hasData ? "content" : "empty";

  return (
    <div className={`ui-loading-boundary ${className}`.trim()} aria-busy={loading}>
      <AnimatePresence initial={false} mode="wait">
        {state === "loading" ? (
          <motion.div
            key="loading"
            className="ui-loading-state"
            role="status"
            aria-label={label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionDuration.standard, delay: 0.1 }}
          >
            {skeleton}
          </motion.div>
        ) : state === "content" ? (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionDuration.standard, ease: motionEase }}
          >
            {children}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionDuration.standard }}
          >
            {empty}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface RefreshOverlayProps {
  refreshing: boolean;
  children: ReactNode;
  label?: string;
  className?: string;
}

/** Leaves stale-but-useful content visible while an explicit refresh is in flight. */
export function RefreshOverlay({ refreshing, children, label = "Checking for updates", className = "" }: RefreshOverlayProps) {
  return (
    <div className={`ui-refresh-region ${className}`.trim()} aria-busy={refreshing}>
      {children}
      <AnimatePresence>
        {refreshing && (
          <motion.div
            className="ui-refresh-overlay"
            role="status"
            aria-label={label}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: motionDuration.fast, ease: motionEase }}
          >
            <span className="ui-refresh-indicator" aria-hidden="true" />
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
