import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StackTab } from "./StackTab";

const app = {
  id: "betting", name: "Betting", category: "Sports", description: "", monitor_target: "health",
  product_url: "https://bet.fly.dev/", health_url: "https://bet.fly.dev/api/v1/health", readiness_url: null, metrics_url: null,
  fly_app: "bet",
  stack: {
    description: "One Fly app serves UI and API.",
    region: "ewr",
    monitoring: "Public health checks",
    nodes: [
      { kind: "ui", name: "Odds UI", tech: "React 18", host: "bet", detail: "" },
      { kind: "api", name: "Odds API", tech: "FastAPI 0.115", host: "bet", detail: "" },
      { kind: "database", name: "Odds DB", tech: "PostgreSQL", host: "Neon", detail: "" },
      { kind: "provider", name: "Odds provider", tech: "The Odds API", host: null, detail: "" },
    ],
  },
};
const result = {
  app_id: "betting", name: "Betting", category: "Sports", description: "", product_url: null, state: "up",
  checked_at: "2026-10-03T00:00:00Z", response_ms: 212, http_status: 200, readiness: null, provider_state: "degraded",
  freshness: null, page_state: null, metrics_state: null, metrics: {}, detail: null, cached: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(JSON.stringify(url.includes("dashboard") ? { results: [result] } : [app])),
  ));
}

describe("StackTab", () => {
  it("draws the hosting boundary, nodes, URLs and per-node health", async () => {
    stubFetch();
    render(<StackTab appId="betting" />);

    expect(await screen.findByText("Fly · bet · ewr")).toBeTruthy();
    expect(screen.getByText("bet.fly.dev/api/v1/health")).toBeTruthy();
    expect(screen.getByText("Host · Neon")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "Odds API: up" })).toBeTruthy();
    expect(screen.getByText("212 ms · HTTP 200")).toBeTruthy();
    // Signals stay separate: the UI and DB are not probed here, the provider reports its own state.
    expect(screen.getByRole("img", { name: "Odds UI: not probed" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Odds DB: not probed" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Odds provider: degraded" })).toBeTruthy();
  });

  it("handles an app without a stack map", async () => {
    stubFetch();
    render(<StackTab appId="unknown" />);

    expect(await screen.findByText("No stack map is available for this application.")).toBeTruthy();
  });
});
