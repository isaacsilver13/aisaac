import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import News from "./News";

const item = {
  id: 1, url: "https://example.com/a", title: "Fed holds rates", source: "Fed", topic: "economics",
  published_at: "2026-10-07T12:00:00+00:00", score: 1.2, why: "economics source, 2h old", state: "new",
};
const okFeed = { feed_url: "u", source: "Fed", last_ok_at: null, last_attempt_at: null, last_error: null };
const snapshot = (over = {}) => ({
  topics: ["economics"], items: [item], freshness_at: new Date().toISOString(), sources: [okFeed], ...over,
});
const json = (body: unknown) => new Response(JSON.stringify(body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("News", () => {
  it("asks for a token when none is stored", () => {
    render(<News />);
    expect(screen.getByText(/dashboard token/)).toBeTruthy();
  });

  it("lists articles with a publisher link", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    vi.stubGlobal("fetch", vi.fn(async () => json(snapshot())));
    render(<News />);
    const link = (await screen.findByText("Fed holds rates")) as HTMLAnchorElement;
    expect(link.href).toBe("https://example.com/a");
    expect(link.rel).toContain("noopener");
  });

  it("only reads the snapshot on open, even when it is old; Refresh POSTs", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json(snapshot({ freshness_at: "2026-01-01T00:00:00+00:00" })));
    vi.stubGlobal("fetch", fetchMock);
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([u]) => u);
    render(<News />);
    await screen.findByText("Fed holds rates");
    expect(posts()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(posts()).toEqual(["/api/v1/personal/news/refresh"]));
  });

  it("shows an error state when the request fails", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    render(<News />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("flags a stale snapshot when a feed failed", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    const failed = [{ ...okFeed, last_error: "fetch_failed" }];
    vi.stubGlobal("fetch", vi.fn(async () => json(snapshot({ sources: failed }))));
    render(<News />);
    expect(await screen.findByText(/failed to refresh/)).toBeTruthy();
  });

  it("shows the empty state before any successful refresh", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    vi.stubGlobal("fetch", vi.fn(async () => json(snapshot({ items: [], freshness_at: null }))));
    render(<News />);
    expect(await screen.findByText(/No feed has refreshed/)).toBeTruthy();
  });

  it("marks a headline read when opened and drops it from the unread filter", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    window.sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/state") ? new Response(null, { status: 204 }) : json(snapshot()),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<News />);
    const link = await screen.findByText("Fed holds rates");
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/1/state"));
      expect(JSON.parse(String((call as unknown as [string, RequestInit])[1].body))).toEqual({ state: "read" });
    });
    fireEvent.click(screen.getByText("Unread 0"));
    expect(screen.queryByText("Fed holds rates")).toBeNull();
  });

  it("disables save without a write token and saves with one", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "t");
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/state") ? new Response(null, { status: 204 }) : json(snapshot()),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<News />);
    expect(((await screen.findByLabelText(/^Save /)) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    window.sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
    render(<News />);
    fireEvent.click(await screen.findByLabelText(/^Save /));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith("/1/state")),
      ).toBe(true),
    );
  });
});
