import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LearningModule } from "../types";

const api = vi.hoisted(() => ({ complete: vi.fn() }));
const module: LearningModule = {
  date: "2026-10-11",
  path: "knowledge/markov.md",
  title: "Markov Chain",
  portal: "knowledge",
  link_map: { "n-gram": "knowledge/n-gram.md" },
  reading: [{ heading: "Definition", markdown: "Predicts the next state, see [[N-gram]]." }],
  questions: [{ kind: "cloze", prompt: "A _____ predicts the next state.", answer: "Markov chain" }],
  exercises: [
    {
      kind: "match",
      prompt: "Match each linked note to its summary.",
      pairs: [
        { path: "knowledge/n-gram.md", term: "N-gram", definition: "Word model." },
        { path: "knowledge/tok.md", term: "Tokenisation", definition: "Splitting text." },
      ],
      options: ["Splitting text.", "Word model."],
    },
  ],
  completed_at: null,
};
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  fetchLearningModule: vi.fn(() => Promise.resolve(module)),
  fetchGraph: vi.fn().mockResolvedValue({
    nodes: [
      { path: "knowledge/markov.md", title: "Markov Chain", folder: "knowledge" },
      { path: "knowledge/n-gram.md", title: "N-gram", folder: "knowledge" },
    ],
    edges: [["knowledge/markov.md", "knowledge/n-gram.md"]],
  }),
  completeLearningModule: api.complete,
}));

import Learning from "./Learning";

beforeEach(() => {
  localStorage.setItem("aisaac.dashboardToken", "t");
  sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Learning page", () => {
  it("renders the module, checks the match exercise and marks it done", async () => {
    api.complete.mockResolvedValue("2026-10-11T13:00:00Z");
    render(
      <MemoryRouter>
        <Learning />
      </MemoryRouter>,
    );
    expect(await screen.findByText("2026-10-11 · Markov Chain")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link", { name: "N-gram" }).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/knowledge/knowledge/n-gram"); // the reading's wikilink (the graph node too)
    expect(screen.getByText("A _____ predicts the next state.")).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Note graph" })).toBeInTheDocument();

    const [first, second] = screen.getAllByRole("combobox");
    fireEvent.change(first, { target: { value: "Word model." } });
    fireEvent.change(second, { target: { value: "Word model." } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByText("✓ correct")).toBeInTheDocument();
    expect(screen.getByText("✗ try again")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(api.complete).toHaveBeenCalledWith("2026-10-11", "knowledge/markov.md");
  });
});
