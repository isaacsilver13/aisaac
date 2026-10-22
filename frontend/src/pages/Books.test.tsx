import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Book, BookRecommendation } from "../types";

const api = vi.hoisted(() => ({ books: vi.fn(), book: vi.fn(), recommend: vi.fn(), add: vi.fn(), status: vi.fn() }));
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  fetchBooks: api.books,
  fetchBook: api.book,
  recommendBooks: api.recommend,
  addBook: api.add,
  setBookStatus: api.status,
}));

import Books from "./Books";

const rec: BookRecommendation = {
  title: "Thinking in Bets",
  author: "Annie Duke",
  why: "Decisions as bets.",
  apple_url: "https://apple/tib",
  audible_search_url: "https://www.audible.com/search?keywords=x",
  libby_search_url: "https://www.overdrive.com/search?q=x",
};
const book: Book = {
  id: 1,
  title: "Thinking in Bets",
  author: "Annie Duke",
  apple_url: "https://apple/tib",
  status: "listening",
  added_at: "2026-10-21T12:00:00+00:00",
  map: {
    nodes: [
      { id: "risk", label: "Risk", kind: "theme", summary: "Known odds." },
      { id: "uncertainty", label: "Uncertainty", kind: "concept", summary: "Unknown odds." },
    ],
    edges: [{ source: "risk", target: "uncertainty", label: "contrasts" }],
  },
};

const renderAt = (url = "/books") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Books />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.setItem("aisaac.dashboardToken", "t");
  sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
  api.books.mockResolvedValue([]);
  api.book.mockResolvedValue(book);
  api.recommend.mockResolvedValue([rec]);
  api.add.mockResolvedValue(book);
  api.status.mockResolvedValue(book);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Books", () => {
  it("shows the empty library and recommends audiobooks that can be added", async () => {
    renderAt();
    expect(await screen.findByText(/No books yet/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/learn about/), "decision making under uncertainty");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(api.recommend).toHaveBeenCalledWith("decision making under uncertainty");
    expect(await screen.findByText("Decisions as bets.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Apple Books" }).getAttribute("href")).toBe("https://apple/tib");
    await userEvent.click(screen.getByRole("button", { name: "Add Thinking in Bets" }));
    expect(api.add).toHaveBeenCalledWith({ title: "Thinking in Bets", author: "Annie Duke", apple_url: "https://apple/tib" });
    expect(await screen.findByRole("button", { name: "Add Thinking in Bets" })).toHaveProperty("disabled", true);
    expect(api.books).toHaveBeenCalledTimes(2); // library reloads after adding
  });

  it("says so when no recommendation is an audiobook", async () => {
    api.recommend.mockResolvedValue([]);
    renderAt();
    await userEvent.type(await screen.findByLabelText(/learn about/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Recommend" }));
    expect(await screen.findByText(/No audiobook matches/)).toBeTruthy();
  });

  it("lists the library and changes a book's status", async () => {
    api.books.mockResolvedValue([book]);
    renderAt();
    const select = await screen.findByLabelText("Status of Thinking in Bets");
    await userEvent.selectOptions(select, "done");
    expect(api.status).toHaveBeenCalledWith(1, "done");
  });

  it("cannot spend the Groq quota or change status without the write token", async () => {
    sessionStorage.clear();
    api.books.mockResolvedValue([book]);
    renderAt();
    expect(await screen.findByLabelText("Status of Thinking in Bets")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Recommend" })).toHaveProperty("disabled", true);
  });

  it("renders the concept map and shows a clicked node's summary", async () => {
    const { container } = renderAt("/books?book=1");
    expect(await screen.findByText("AI-generated outline")).toBeTruthy();
    expect(api.book).toHaveBeenCalledWith(1, "t");
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    expect(container.querySelectorAll("line")).toHaveLength(1);
    expect(screen.getByText("Click a node to read its summary.")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Uncertainty" })); // userEvent's mousedown trips d3-zoom in jsdom
    expect(await screen.findByText("Unknown odds.")).toBeTruthy();
  });
});
