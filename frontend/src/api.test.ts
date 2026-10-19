import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAgents,
  fetchAnalytics,
  fetchComsEvents,
  fetchDashboard,
  fetchIncidents,
  resolveIncident,
} from "./api";

const response = {
  profile: "local",
  refreshed_at: "2026-09-09T12:00:00Z",
  results: [],
};

describe("fetchDashboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests the dashboard without allowing a target URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboard()).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/dashboard", {
      headers: { Accept: "application/json" },
    });
  });

  it("adds an explicit refresh query when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchDashboard(true, "read-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/dashboard?force_refresh=true", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "read-token" },
    });
  });

  it("turns a failed response into a user-safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret body", { status: 503 })));

    await expect(fetchDashboard()).rejects.toThrow("Dashboard request failed with HTTP 503.");
  });
});

describe("fetchAgents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests the agent roster", async () => {
    const agents = [
      {
        id: "repo-maintainer",
        name: "Repo Manager",
        domain: "Repo hygiene",
        description: "Audits repos.",
        scope: ["vinyl"],
        last_run_at: null,
        last_run_note: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(agents), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAgents()).resolves.toEqual(agents);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/agents", {
      headers: { Accept: "application/json" },
    });
  });

  it("turns a failed response into a user-safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret body", { status: 500 })));

    await expect(fetchAgents()).rejects.toThrow("Agents request failed with HTTP 500.");
  });
});

describe("fetchAnalytics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests repo activity without a force-refresh query by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAnalytics()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/analytics", {
      headers: { Accept: "application/json" },
    });
  });

  it("adds an explicit refresh query when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAnalytics(true, "read-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/analytics?force_refresh=true", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "read-token" },
    });
  });

  it("sends the read token when one is saved so private repos are included", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAnalytics(false, "read-token");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/analytics", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "read-token" },
    });
  });

  it("turns a failed response into a user-safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret body", { status: 502 })));

    await expect(fetchAnalytics()).rejects.toThrow("Analytics request failed with HTTP 502.");
  });
});

describe("fetchComsEvents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests Coms history without an app_id filter by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchComsEvents()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/coms", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "" },
    });
  });

  it("adds an app_id filter when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchComsEvents("vinyl");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/coms?app_id=vinyl", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "" },
    });
  });

  it("turns a failed response into a user-safe error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret body", { status: 500 })));

    await expect(fetchComsEvents()).rejects.toThrow("Coms request failed with HTTP 500.");
  });
});

describe("incident authorization headers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("sends the read token when listing incidents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchIncidents("read-abc");

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/incidents", {
      headers: { Accept: "application/json", "X-Dashboard-Token": "read-abc" },
    });
  });

  it("resolves with the write token and never the read token", async () => {
    window.localStorage.setItem("aisaac.dashboardToken", "read-abc");
    window.sessionStorage.setItem("aisaac.dashboardWriteToken", "write-xyz");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveIncident(7, "done");

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["X-Dashboard-Write-Token"]).toBe("write-xyz");
    expect(JSON.stringify(init.headers)).not.toContain("read-abc");
  });

  it("surfaces an unauthorized resolve as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(resolveIncident(7, undefined, "bad")).rejects.toThrow("HTTP 401");
  });
});
