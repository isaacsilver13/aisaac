import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Automations from "./Automations";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const row = (over: object) => ({
  id: "x", name: "Neon usage push", kind: "push", detail: "scripts/", last_run_at: null, expected_hours: 26, status: "never",
  next_expected_at: null, overdue_hours: null, last_error: null, last_error_at: null, ...over,
});

describe("Automations", () => {
  it("asks for a token when none is stored", () => {
    render(<Automations />);
    expect(screen.getByText(/dashboard token/)).toBeTruthy();
  });

  it("summarises status, shows overdue and failure details, and opens run history", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/runs")
        ? [{ ran_at: "2026-10-03T00:00:00Z", ok: false, detail: "invalid_payload" }, { ran_at: "2026-10-02T00:00:00Z", ok: true, detail: "" }]
        : [
            row({}),
            row({ id: "fly", name: "Fly cost push", status: "failing", last_run_at: "2026-10-01T00:00:00Z", next_expected_at: "2026-10-02T02:00:00Z", overdue_hours: 30, last_error: "invalid_payload", last_error_at: "2026-10-03T00:00:00Z" }),
          ],
    )));
    vi.stubGlobal("fetch", fetchMock);
    render(<Automations />);
    expect(await screen.findByText("Neon usage push")).toBeTruthy();
    expect(screen.getByText("30 h")).toBeTruthy();
    expect(screen.getByText("invalid_payload")).toBeTruthy();
    expect(screen.getAllByText("failing").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Fly cost push" }));
    expect(await screen.findByText("Fly cost push: recent runs")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/automations/fly/runs", expect.anything());
    expect((await screen.findAllByRole("listitem")).length).toBe(2);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
  });
});
