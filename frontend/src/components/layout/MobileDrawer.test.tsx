import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileDrawer } from "./MobileDrawer";

afterEach(cleanup);

describe("MobileDrawer", () => {
  it("keeps monitored application links available in the mobile navigation", () => {
    render(
      <MemoryRouter initialEntries={["/applications/vinyl/health"]}>
        <MobileDrawer open onClose={vi.fn()} apps={[{ id: "vinyl", name: "Vinyl Catalog" }]} />
      </MemoryRouter>,
    );

    const appLink = screen.getByRole("link", { name: "Vinyl Catalog" });
    expect(appLink).toHaveAttribute(
      "href",
      "/applications/vinyl/overview",
    );
    expect(appLink).toHaveAttribute("aria-current", "page");
    expect(appLink).toHaveClass("app-sidebar-link-active");
  });
});
