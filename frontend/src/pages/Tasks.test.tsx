import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import Tasks from "./Tasks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const repo = { repo_id: "vinyl", name: "Vinyl Catalog", open_pull_requests: [{ number: 1, title: "Fix it", url: "https://x", opened_at: "2026-10-01T00:00:00Z", stale: true }] };
const open = { id: 1, app_id: "vinyl", failure_type: "down", started_at: "2026-10-02T00:00:00Z", resolved_at: null, notes: null };
const ci = (status: string, at: string, details: string) => ({ id: 1, app_id: "vinyl", repo: "o/vinyl", event_type: "status_report", ci_status: status, details, received_at: at, notified: false });
const automation = (id: string, status: string) => ({ id, name: `Job ${id}`, kind: "push", detail: "", last_run_at: null, expected_hours: 26, status, next_expected_at: null, overdue_hours: 5, last_error: null, last_error_at: null });

function stub() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body =
      url.includes("analytics") ? [repo]
      : url.includes("incidents") ? [open, { ...open, id: 2, failure_type: "old", resolved_at: "2026-10-02T01:00:00Z" }]
      : url.includes("coms") ? [ci("failure", "2026-10-03T00:00:00Z", "tests red"), ci("success", "2026-10-02T00:00:00Z", "older green")]
      : [automation("a", "stale"), automation("b", "ok")];
    return new Response(JSON.stringify(body));
  }));
  render(<MemoryRouter><Tasks /></MemoryRouter>);
}

describe("Tasks", () => {
  it("merges PRs, open incidents, failing CI and late automations", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    stub();
    expect(await screen.findByText("Fix it")).toBeTruthy();
    expect(screen.getByText("down")).toBeTruthy();
    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("tests red")).toBeTruthy();
    expect(screen.getByText("Job a is 5 h overdue")).toBeTruthy();
    expect(screen.queryByText(/Job b/)).toBeNull();
    expect(screen.getByText(/4 need attention/)).toBeTruthy();
    // Incident and CI rows show the app's display name, not its id.
    expect(screen.getAllByRole("cell", { name: "Vinyl Catalog" }).length).toBe(3);
  });

  it("groups by app/repo", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    stub();
    await screen.findByText("Fix it");
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "source" } });
    expect(screen.getByRole("heading", { name: "Vinyl Catalog (3)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AIsaac (1)" })).toBeTruthy();
  });

  it("skips token-gated sources without a token", async () => {
    stub();
    expect(await screen.findByText("Fix it")).toBeTruthy();
    expect(screen.queryByText("down")).toBeNull();
    expect(screen.queryByText(/Job a/)).toBeNull();
  });
});
