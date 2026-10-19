import { describe, expect, it } from "vitest";
import { isOperational } from "./health";
import type { HealthState } from "./types";

describe("operational service status", () => {
  it.each<HealthState>(["stale", "unavailable", "down", "degraded"])("excludes %s", (state) => {
    expect(isOperational(state)).toBe(false);
  });
  it.each<HealthState>(["up", "slow"])("includes %s", (state) => {
    expect(isOperational(state)).toBe(true);
  });
});
