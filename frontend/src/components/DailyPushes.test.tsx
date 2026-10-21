import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyPushes } from "./DailyPushes";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function stubFetch(putStatus = 204) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response(null, { status: putStatus })
      : new Response(JSON.stringify([{ kind: "philosophy_morning", hour: 7, enabled: false }])),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DailyPushes", () => {
  it("toggles a push with the write token", async () => {
    sessionStorage.setItem("aisaac.dashboardWriteToken", "w");
    const fetchMock = stubFetch();
    render(<DailyPushes token="t" canWrite />);
    const box = await screen.findByRole("checkbox", { name: /Philosophy morning/ });
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/v1/personal/pushes/philosophy_morning");
    expect(init?.body).toBe(JSON.stringify({ enabled: true }));
  });

  it("reverts and reports a failed save", async () => {
    stubFetch(401);
    render(<DailyPushes token="t" canWrite />);
    const box = await screen.findByRole("checkbox", { name: /Philosophy morning/ });
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it("is read-only without the write token", async () => {
    stubFetch();
    render(<DailyPushes token="t" canWrite={false} />);
    expect(((await screen.findByRole("checkbox")) as HTMLInputElement).disabled).toBe(true);
  });
});
