import { describe, expect, it } from "vitest";

import { centralTimestamp, exactTimestamp, humanizeTimestamp } from "./time";

const NOW = new Date("2026-10-06T19:00:00Z");

describe("humanizeTimestamp", () => {
  it("uses relative labels for recent activity", () => {
    expect(humanizeTimestamp("2026-10-06T18:55:00Z", NOW)).toBe("5 minutes ago");
    expect(humanizeTimestamp("2026-10-06T18:00:00Z", NOW)).toBe("1 hour ago");
  });

  it("falls back to the full Central timestamp after a day", () => {
    expect(humanizeTimestamp("2026-10-05T14:30:00Z", NOW)).toBe("2026/10/05 09:30:00");
  });

  it("keeps invalid timestamps explicit", () => {
    expect(humanizeTimestamp("not-a-date", NOW)).toBe("Unknown time");
    expect(exactTimestamp("not-a-date")).toBe("not-a-date");
  });

  it("formats yyyy/mm/dd HH:mm:ss in Central time across DST", () => {
    expect(centralTimestamp("2026-01-01T18:30:05Z")).toBe("2026/01/01 12:30:05");
    expect(centralTimestamp("2026-07-01T17:30:00Z")).toBe("2026/07/01 12:30:00");
    expect(centralTimestamp("2026-03-02T05:59:59Z")).toBe("2026/03/01 23:59:59");
    expect(centralTimestamp("2026-03-02T06:00:00Z")).toBe("2026/03/02 00:00:00");
  });
});
