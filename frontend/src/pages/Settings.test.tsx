import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readToken } from "../token";
import Settings from "./Settings";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Settings", () => {
  it("saves and clears the dashboard token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("pushes") ? [] : { items: [] }))),
    );
    render(<Settings />);
    await userEvent.type(screen.getByLabelText("Dashboard token"), " abc ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(readToken()).toBe("abc");
    expect(screen.getByText("A token is saved.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(readToken()).toBe("");
  });
});
