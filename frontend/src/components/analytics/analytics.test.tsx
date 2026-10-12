import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RepoActivity } from "../../types";
import { CommitActivityChart } from "./CommitActivityChart";
import {
  commitStreaks,
  dailyCommits,
  languageShares,
  medianHoursToMerge,
  weekStart,
  weeklyCommitsByRepo,
  weeklyPullRequests,
} from "./githubStats";

function makeActivity(overrides: Partial<RepoActivity>): RepoActivity {
  return {
    repo_id: "repo",
    name: "Repo",
    category: "app",
    owner: "isaacsilver13",
    repo: "repo",
    ci_status: "success",
    open_issue_count: 0,
    open_pr_count: 0,
    open_pull_requests: [],
    commits_last_7d: 0,
    last_commit_at: null,
    checked_at: "2026-09-25T12:00:00Z",
    cached: false,
    detail: null,
    private: false,
    description: null,
    language: null,
    pushed_at: null,
    languages: {},
    commit_weeks: [],
    pull_request_history: [],
    ...overrides,
  };
}

describe("CommitActivityChart", () => {
  it("shows an empty state when no repo has commit data", () => {
    render(<CommitActivityChart activity={[makeActivity({ commits_last_7d: null })]} />);
    expect(screen.getByText("No commits in the last 7 days.")).toBeInTheDocument();
  });

  it("renders a chart when commit data is present", () => {
    const { container } = render(<CommitActivityChart activity={[makeActivity({ name: "Vinyl", commits_last_7d: 5 })]} />);
    expect(container.querySelector(".recharts-responsive-container")).toBeInTheDocument();
  });
});

// Sunday 2026-10-04 00:00 UTC; "now" is the following Wednesday.
const WEEK = "2026-10-04T00:00:00Z";
const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("githubStats", () => {
  it("anchors weeks to Sunday UTC like GitHub's stats", () => {
    expect(new Date(weekStart(NOW)).toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("sums daily commits across repos and measures streaks", () => {
    const repos = [
      makeActivity({ commit_weeks: [{ week: WEEK, days: [1, 0, 2, 3, 0, 0, 0] }] }),
      makeActivity({ commit_weeks: [{ week: WEEK, days: [0, 1, 0, 0, 0, 0, 0] }] }),
    ];
    const daily = dailyCommits(repos);
    expect(daily.get("2026-10-04")).toBe(1);
    expect(daily.get("2026-10-05")).toBe(1);
    expect(daily.get("2026-10-07")).toBe(3);
    expect(daily.has("2026-10-08")).toBe(false);
    // Sun..Wed all have commits; "now" is Wednesday.
    expect(commitStreaks(daily, NOW)).toEqual({ current: 4, longest: 4 });
    // On Thursday with nothing yet, the streak still counts through yesterday.
    expect(commitStreaks(daily, NOW + 86_400_000).current).toBe(4);
    expect(commitStreaks(daily, NOW + 2 * 86_400_000).current).toBe(0);
  });

  it("folds repos past the series cap into Other, most active first", () => {
    const repos = [1, 5, 3].map((n) => makeActivity({ name: `r${n}`, commit_weeks: [{ week: WEEK, days: [n, 0, 0, 0, 0, 0, 0] }] }));
    const { rows, series } = weeklyCommitsByRepo(repos, 2, 2, NOW);
    expect(series).toEqual(["r5", "r3", "Other"]);
    expect(rows[1]).toEqual({ week: "2026-10-04", r5: 5, r3: 3, Other: 1 });
    expect(rows[0]).toEqual({ week: "2026-09-27", r5: 0, r3: 0, Other: 0 });
  });

  it("buckets PRs by the week they were opened and merged", () => {
    const repo = makeActivity({
      pull_request_history: [
        { opened_at: "2026-10-01T00:00:00Z", merged_at: "2026-10-05T00:00:00Z" },
        { opened_at: "2026-10-06T00:00:00Z", merged_at: "2026-10-06T06:00:00Z" },
        { opened_at: "2026-10-06T00:00:00Z", merged_at: null },
      ],
    });
    expect(weeklyPullRequests([repo], 2, NOW)).toEqual([
      { week: "2026-09-27", opened: 1, merged: 0 },
      { week: "2026-10-04", opened: 2, merged: 2 },
    ]);
    expect(medianHoursToMerge([repo], 84, NOW)).toBe((96 + 6) / 2);
    expect(medianHoursToMerge([makeActivity({})], 84, NOW)).toBeNull();
  });

  it("reports language shares with the tail folded into Other", () => {
    const repos = [
      makeActivity({ languages: { Python: 600, CSS: 100 } }),
      makeActivity({ languages: { Python: 200, TypeScript: 100 } }),
    ];
    expect(languageShares(repos, 2)).toEqual([
      { language: "Python", share: 0.8 },
      { language: "CSS", share: 0.1 },
      { language: "Other", share: 0.1 },
    ]);
  });
});
