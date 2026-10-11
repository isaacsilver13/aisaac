import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import Applications from "./Applications";

const app = {
  id: "chess", name: "Chess", category: "Games", description: "", monitor_target: "health",
  product_url: "https://aisaac-chess.fly.dev/", health_url: null, readiness_url: null, metrics_url: null, fly_app: "aisaac-chess",
  stack: {
    description: "", region: "ewr", monitoring: "",
    nodes: [
      { kind: "ui", name: "Board", tech: "React 19 · Vite 8", host: "aisaac-chess", detail: "" },
      { kind: "api", name: "Server", tech: "Hono 4 · Node", host: "aisaac-chess", detail: "" },
      { kind: "database", name: "Games", tech: "SQLite", host: "aisaac-chess", detail: "" },
    ],
  },
};
const result = { app_id: "chess", state: "up" };
const history = {
  summary: { uptime_pct: 99.5 },
  points: [{ t: "a", state: "up", response_ms: 100 }, { t: "b", state: "up", response_ms: 300 }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Applications", () => {
  it("summarises each registered app's health, stack, host and trend", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      new Response(JSON.stringify(
        url.includes("dashboard") ? { results: [result] } : url.includes("health-history") ? history : [app],
      )),
    ));
    render(<MemoryRouter><Applications /></MemoryRouter>);

    expect(await screen.findByText("Chess")).toBeTruthy();
    expect(screen.getByText("Operational")).toBeTruthy();
    expect(screen.getByText("React 19 → Hono 4 → SQLite")).toBeTruthy();
    expect(screen.getByText("Fly · aisaac-chess · ewr")).toBeTruthy();
    expect(screen.getByText("99.5%")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Response time, average 200 ms" })).toBeTruthy();
    expect(screen.getByText("Add your dashboard token in Settings to see last deploys.")).toBeTruthy();
  });
});
