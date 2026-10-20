import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Assistant from "./Assistant";

const game = (over = {}) => ({
  id: "g1", league: "NBA", home: "Chicago Bulls", away: "Toronto Raptors", home_score: null,
  away_score: null, status: "scheduled", start_at: "2026-10-20T00:00:00+00:00", home_conference: null,
  away_conference: null, home_rank: null, away_rank: null, poll_date: null, url: null, ...over,
});

const brief = (over = {}) => ({
  generated_at: "2026-10-19T13:00:00+00:00",
  calendar: { state: "ok", events: [{ title: "Dentist", all_day: false, start: "2026-10-19T15:00:00-05:00", end: null, location: "Evanston" }] },
  projects: {
    state: "ok", reported_at: "2026-10-19T12:00:00+00:00",
    projects: [
      { folder: "gym_tracker", slug: "isaacsilver13/gym", last_activity_at: "2026-10-18T12:00:00+00:00",
        note: { branch: "claude/x", updated_at: "2026-10-18T12:00:00+00:00", text: "Doing: summary endpoint\nNext: tests" },
        other_notes: 0, worktrees: [{ folder: "gym_tracker", branch: "main", last_commit_at: null, last_commit_subject: "", dirty_files: 2, ahead: 0 }],
        ci_status: "failure", open_prs: [], reasons: ["latest CI run failed"] },
    ],
  },
  games: { configured: true, priority: [game()], top_25: [], slate: { NFL: [], NBA: [] } },
  gym: { state: "not_connected", app_url: null, data: null },
  ...over,
});
const json = (body: unknown) => new Response(JSON.stringify(body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Assistant", () => {
  it("asks for a token when none is stored", () => {
    render(<Assistant />);
    expect(screen.getByText(/dashboard token/)).toBeTruthy();
  });

  it("shows calendar, games, projects needing attention and the left-off note", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    vi.stubGlobal("fetch", vi.fn(async () => json(brief())));
    render(<Assistant />);
    expect(await screen.findByText(/3:00 PM · Dentist \(Evanston\)/)).toBeTruthy();
    expect(screen.getByText(/Toronto Raptors @ Chicago Bulls/)).toBeTruthy();
    expect(screen.getByText("latest CI run failed")).toBeTruthy();
    expect(screen.getByText(/Doing: summary endpoint · Next: tests/)).toBeTruthy();
    expect(screen.getByText(/2 uncommitted files/)).toBeTruthy();
    expect(screen.getByText("Gym Tracker isn't connected.")).toBeTruthy();
  });

  it("explains a section that is not connected without hiding the others", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    vi.stubGlobal("fetch", vi.fn(async () => json(brief({ calendar: { state: "not_connected", events: [] } }))));
    render(<Assistant />);
    expect(await screen.findByText(/Calendar isn't connected/)).toBeTruthy();
    expect(screen.getByText(/Toronto Raptors @ Chicago Bulls/)).toBeTruthy();
  });

  it("shows gym_tracker's next day and 30-day bests", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    const set = { logged_at: "2026-10-18T12:00:00", weight_lb: 185, reps_done: 8 };
    const gym = {
      state: "ok", app_url: "https://gym.test",
      data: {
        username: "isaac", routine: { id: 1, name: "PPL", is_active: true },
        next_gym_day: { id: 2, name: "Pull" }, last_session_date: "2026-10-18",
        exercises: [
          { id: 1, name: "Bench", muscle_group: "Chest", gym_day: "Push", latest: set, best_30d: set },
          { id: 2, name: "Row", muscle_group: "Back", gym_day: "Pull", latest: null, best_30d: null },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => json(brief({ gym }))));
    render(<Assistant />);
    expect(await screen.findByText("Pull")).toBeTruthy();
    expect(screen.getByText("Bench: best 185 lb × 8 (30 days)")).toBeTruthy();
    expect(screen.queryByText(/Row: best/)).toBeNull();
  });
});
