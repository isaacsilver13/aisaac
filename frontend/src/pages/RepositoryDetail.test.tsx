import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import RepositoryDetail from "./RepositoryDetail";

const repo = {
  repo_id: "a", name: "Alpha", owner: "me", repo: "alpha", category: "c", ci_status: "success", detail: null,
  open_pr_count: 1, open_issue_count: 0, commits_last_7d: 4, last_commit_at: null,
  private: false, description: null, language: "Python", pushed_at: null,
  languages: { Python: 10 }, commit_weeks: [], pull_request_history: [],
  open_pull_requests: [{ number: 9, title: "Add thing", url: "https://x", opened_at: "2026-10-01T00:00:00Z", stale: false }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("analytics") ? [repo] : []))));
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/github/repositories/:repo" element={<RepositoryDetail />} /></Routes>
    </MemoryRouter>,
  );
}

describe("RepositoryDetail", () => {
  it("shows the repo's stats and open pull requests", async () => {
    renderAt("/github/repositories/a");
    expect(await screen.findByText("Add thing")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("No CI events received.")).toBeTruthy();
  });

  it("says so for an untracked repo", async () => {
    renderAt("/github/repositories/zzz");
    expect(await screen.findByText(/That repository is not tracked/)).toBeTruthy();
  });
});
