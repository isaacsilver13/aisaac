import type { HealthState } from "./types";

export function isOperational(state: HealthState): boolean {
  return state === "up" || state === "slow";
}
