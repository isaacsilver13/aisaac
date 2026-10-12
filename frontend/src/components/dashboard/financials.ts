import { centralTimestamp } from "../../time";
import type { Tone } from "../primitives/tone";

export const USAGE_STALE_MS = 30 * 60 * 1000;
export const COST_STALE_MS = 36 * 60 * 60 * 1000;

export function usageTone(pct: number): Tone {
  if (pct >= 90) return "error";
  if (pct >= 75) return "warning";
  return "success";
}

export function isStale(reportedAt: string, maxAgeMs: number, now = Date.now()): boolean {
  return now - new Date(reportedAt).getTime() > maxAgeMs;
}

/** "2h 14m", "3d 4h", or "now" when the reset time has passed. */
export function formatTimeUntil(target: string, now = Date.now()): string {
  const minutes = Math.floor((new Date(target).getTime() - now) / 60000);
  if (minutes <= 0) return "now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export const formatResetAt = centralTimestamp;

export function formatHours(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} h`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
