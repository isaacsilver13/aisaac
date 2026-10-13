import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";

afterEach(cleanup);

// jsdom has no matchMedia, which the theme toggle reads.
window.matchMedia ??= (() => ({ matches: false })) as unknown as typeof window.matchMedia;

function setup({ collapsed = false, initialEntry = "/" } = {}) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Sidebar
        status={{ label: "ok", tone: "success" }}
        apps={[{ id: "a", name: "Alpha" }]}
        collapsed={collapsed}
        onToggleCollapsed={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("lists apps under Applications and toggles the list", async () => {
    setup();
    expect(screen.getByText("Alpha")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Collapse applications" }));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
  });

  it("groups Sports, News and Shoes under a collapsible Life section", async () => {
    setup();
    const life = screen.getByRole("button", { name: "Life" });
    expect(life).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "News" })).toHaveAttribute("href", "/news");
    await userEvent.click(life);
    await waitFor(() => expect(screen.queryByRole("link", { name: "Sports" })).toBeNull());
  });

  it("keeps Life links reachable as icons when the sidebar is collapsed", () => {
    setup({ collapsed: true });
    expect(screen.queryByRole("button", { name: "Life" })).toBeNull();
    expect(screen.getByTitle("Shoes")).toHaveAttribute("href", "/shoes");
  });

  it("keeps the application selected on nested tabs", () => {
    setup({ initialEntry: "/applications/a/health" });

    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveClass("app-sidebar-link-active");
  });
});
