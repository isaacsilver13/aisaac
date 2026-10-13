import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthTab } from "./HealthTab";

const history = (range: string) => ({
  app_id: "a",
  range,
  summary: { checks: 4, uptime_pct: 75, avg_response_ms: 120, p95_response_ms: 300, last_state: "up", last_checked_at: null },
  points: [],
});
const incident = { id: 1, app_id: "a", failure_type: "down", started_at: "2026-10-01T00:00:00Z", resolved_at: null, notes: null };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HealthTab", () => {
  it("shows summary, refetches on range change, and lists only this app's incidents", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("health-history") ? history(url.split("range=")[1]) : [incident, { ...incident, id: 2, app_id: "b" }])),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<HealthTab appId="a" />);
    expect(await screen.findByText("75%")).toBeTruthy();
    expect(await screen.findAllByRole("row")).toHaveLength(2); // header + one incident

    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("range=7d"))).toBe(true));
  });

  it("replaces the previous range with a labeled loading state", async () => {
    let resolveSevenDays!: (response: Response) => void;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("range=7d")) {
        return new Promise<Response>((resolve) => {
          resolveSevenDays = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify(url.includes("health-history") ? history("24h") : [])));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HealthTab appId="a" />);
    expect(await screen.findByText("75%")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(await screen.findByRole("status", { name: "Loading 7d health history" })).toBeTruthy();
    expect(screen.queryByText("75%")).toBeNull();

    resolveSevenDays(new Response(JSON.stringify(history("7d"))));
    expect(await screen.findByText("75%")).toBeTruthy();
  });
});
