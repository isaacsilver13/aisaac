import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PhilosophyToday } from "../types";

const api = vi.hoisted(() => ({ save: vi.fn(), journal: vi.fn() }));
const today: PhilosophyToday = {
  date: "2026-10-21",
  entry: {
    id: "epictetus-03",
    school: "stoic",
    author: "Epictetus",
    source: "Enchiridion, ch. VIII, trans. Thomas Wentworth Higginson (1865)",
    paraphrase: false,
    passage: "Demand not that events should happen as you wish.",
    theme: "Acceptance",
    morning_prompt: "Expect one thing to go differently.",
    evening_question: "What did you fight today?",
  },
  journal: { local_date: "2026-10-21", entry_id: "epictetus-03", intention: "Be patient", reflection: null, updated_at: "x" },
};
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  fetchPhilosophyToday: vi.fn(() => Promise.resolve(today)),
  fetchJournal: api.journal,
  saveJournal: api.save,
}));

import Philosophy from "./Philosophy";

beforeEach(() => {
  localStorage.setItem("aisaac.dashboardToken", "t");
  sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
  api.journal.mockResolvedValue([]);
  api.save.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Philosophy", () => {
  it("shows today's passage and saves a reflection without losing the intention", async () => {
    render(<Philosophy />);
    expect(await screen.findByText(today.entry.passage)).toBeTruthy();
    expect((screen.getByLabelText(/Morning:/) as HTMLInputElement).value).toBe("Be patient");
    await userEvent.type(screen.getByLabelText(/Evening:/), "Mostly calm.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.save).toHaveBeenCalledWith("2026-10-21", { intention: "Be patient", reflection: "Mostly calm." });
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(api.journal).toHaveBeenCalledTimes(2); // history reloads after saving
  });

  it("cannot save without the write token", async () => {
    sessionStorage.clear();
    render(<Philosophy />);
    expect(((await screen.findByRole("button", { name: "Save" })) as HTMLButtonElement).disabled).toBe(true);
  });
});
