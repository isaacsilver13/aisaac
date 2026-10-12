import type { HealthState } from "../../types";

/** Shared semantic tone used by Badge, StatusDot, and other status-bearing primitives. */
export type Tone = "success" | "warning" | "error" | "info" | "neutral";

export const STATE_TONE: Record<HealthState, Tone> = {
  up: "success",
  slow: "warning",
  stale: "warning",
  degraded: "error",
  down: "error",
  unavailable: "neutral",
};
