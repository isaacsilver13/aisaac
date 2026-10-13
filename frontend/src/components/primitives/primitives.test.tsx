import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { Badge } from "./Badge";
import { Card, CardContent, CardHeader } from "./Card";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingBoundary, RefreshOverlay } from "./LoadingBoundary";
import { PageHeader } from "./PageHeader";
import { SkeletonStack } from "./Skeleton";
import { Stat } from "./Stat";
import { StatusDot } from "./StatusDot";

describe("Card", () => {
  it("renders children and applies the requested variant class", () => {
    render(
      <Card variant="elevated" data-testid="card">
        <CardHeader>Header</CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("ui-card", "ui-card-elevated");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("applies the tone class and renders its label", () => {
    render(<Badge tone="success">Operational</Badge>);
    expect(screen.getByText("Operational")).toHaveClass("ui-badge-success");
  });
});

describe("StatusDot", () => {
  it("exposes an accessible label instead of relying on color alone", () => {
    render(<StatusDot tone="error" label="Down" />);
    expect(screen.getByRole("img", { name: "Down" })).toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("renders a label/value pair", () => {
    render(<Stat label="Response time" value="142 ms" />);
    expect(screen.getByText("Response time")).toBeInTheDocument();
    expect(screen.getByText("142 ms")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the provided message", () => {
    render(<EmptyState message="No recent activity" />);
    expect(screen.getByText("No recent activity")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("calls onRetry when the retry button is clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Unable to load activity" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("disables the retry button and relabels it while retrying", () => {
    render(<ErrorState message="Unable to load activity" onRetry={() => {}} retrying />);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  });
});

describe("PageHeader", () => {
  it("renders title, description, and last-updated timestamp", () => {
    render(<PageHeader title="Command Center" description="Monitor everything" lastUpdated="12:42 PM" />);
    expect(screen.getByRole("heading", { name: "Command Center" })).toBeInTheDocument();
    expect(screen.getByText("Monitor everything")).toBeInTheDocument();
    expect(screen.getByText("Last updated 12:42 PM")).toBeInTheDocument();
  });
});

describe("LoadingBoundary", () => {
  it("shows a labeled loading placeholder instead of empty content", () => {
    render(
      <LoadingBoundary loading hasData={false} label="Loading releases" skeleton={<SkeletonStack rows={3} />} empty={<p>No releases</p>}>
        <p>Release history</p>
      </LoadingBoundary>,
    );

    expect(screen.getByRole("status", { name: "Loading releases" })).toBeInTheDocument();
    expect(screen.queryByText("Release history")).not.toBeInTheDocument();
    expect(screen.queryByText("No releases")).not.toBeInTheDocument();
  });

  it("keeps loaded content visible beneath a refresh indicator", () => {
    render(
      <RefreshOverlay refreshing label="Refreshing releases">
        <p>Existing release history</p>
      </RefreshOverlay>,
    );

    expect(screen.getByText("Existing release history")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Refreshing releases" })).toHaveTextContent("Refreshing releases");
  });
});
