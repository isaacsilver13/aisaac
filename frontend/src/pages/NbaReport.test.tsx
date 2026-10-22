import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NbaPick, NbaReport as Report } from "../types";

const api = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  fetchNbaReport: api.report,
}));

import NbaReport from "./NbaReport";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const base = { game_id: 1, home: "GSW", away: "NYK", tip: "2026-10-22T02:00:00+00:00", book: "betrivers" };
const targeted: NbaPick = {
  ...base, tier: "targeted", market: "moneyline", side: "home", team: "GSW", line: null,
  price_american: -295, model_prob: 0.8, market_prob: 0.726, ev: 0.0712, kelly_frac: 0.063,
};
const watch: NbaPick = {
  ...base, tier: "watchlist", market: "spread", side: "home", team: "GSW", line: -7.5,
  price_american: -105, model_prob: 0.571, market_prob: 0.4962, ev: 0.1148, kelly_frac: 0.0362,
};
const record = { picks: 1, graded: 0, won: 0, lost: 0, push: 0, flat_roi: null, avg_clv: null, clv_samples: 0, beat_close_pct: null };
const report = (overrides: Partial<Report> = {}): Report => ({
  kind: "nba_daily_report",
  slate_date: today,
  generated_at: "2026-10-21T15:15:04+00:00",
  model_version: "margin-noline-df6993e1",
  data_through: "2026-10-20",
  odds_as_of: "2026-10-21T15:00:00+00:00",
  games: [{ ...base, pred_margin: 10, p_home_win: 0.8, market_spread_home: -7.5, market_home_win_prob: 0.726, books: 5 }],
  picks: [targeted, watch],
  track_record: [{ tier: "targeted", ...record }, { tier: "watchlist", ...record }],
  received_at: "2026-10-21T15:15:05+00:00",
  ...overrides,
});

beforeEach(() => localStorage.setItem("aisaac.dashboardToken", "t"));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const section = (name: RegExp) => screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("NbaReport", () => {
  it("shows targeted and watchlist picks, game cards and the unmet CLV gate", async () => {
    api.report.mockResolvedValue(report());
    render(<NbaReport />);
    expect(await screen.findByRole("heading", { name: "Targeted" })).toBeTruthy();
    expect(screen.queryByText(/No report yet today/)).toBeNull();

    const t = within(section(/^Targeted$/));
    expect(t.getByText("GSW ML")).toBeTruthy();
    expect(t.getByText("−295")).toBeTruthy();
    expect(t.getByText("7.1%")).toBeTruthy(); // EV
    expect(t.getByText("6.3%")).toBeTruthy(); // Kelly % of bankroll
    expect(t.getByText("72.6%")).toBeTruthy(); // no-vig market
    expect(t.queryByText("GSW −7.5")).toBeNull();

    const w = within(section(/Watchlist/));
    expect(w.getByText("Unproven — tracking only")).toBeTruthy();
    expect(w.getByText("GSW −7.5")).toBeTruthy();

    const games = within(section(/^Games$/));
    expect(games.getByText("GSW by 10.0")).toBeTruthy();
    expect(games.getByText("80.0%")).toBeTruthy();

    expect(screen.getByText("Gate not met")).toBeTruthy();
    expect(screen.getByText(/CLV ≥ \+1% over 200 targeted picks/)).toBeTruthy();
  });

  it("says when there are no edges today", async () => {
    api.report.mockResolvedValue(report({ picks: [watch] }));
    render(<NbaReport />);
    expect(await screen.findByText(/No edges today/)).toBeTruthy();
    expect(within(section(/Watchlist/)).getByText("GSW −7.5")).toBeTruthy();
  });

  it("says there is no report yet when nothing has been pushed", async () => {
    api.report.mockResolvedValue(null);
    render(<NbaReport />);
    expect(await screen.findByText(/No report yet today/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Targeted" })).toBeNull();
  });

  it("flags an older report as not today's", async () => {
    api.report.mockResolvedValue(report({ slate_date: "2026-10-01" }));
    render(<NbaReport />);
    expect(await screen.findByText(/No report yet today/)).toBeTruthy();
    expect(screen.getByText(/Last report 2026-10-01/)).toBeTruthy();
  });

  it("marks the gate met at +1% CLV over 200 picks", async () => {
    const met = { ...record, picks: 210, graded: 205, won: 110, lost: 92, push: 3, avg_clv: 0.012, clv_samples: 200, beat_close_pct: 58 };
    api.report.mockResolvedValue(report({ track_record: [{ tier: "targeted", ...met }, { tier: "watchlist", ...record }] }));
    render(<NbaReport />);
    expect(await screen.findByText("Gate met")).toBeTruthy();
    expect(screen.getByText("110-92-3")).toBeTruthy();
    expect(screen.getByText("1.20%")).toBeTruthy();
  });
});
