import { useCallback } from "react";
import { Refresh } from "iconoir-react";

import { fetchAssistant } from "../api";
import { Badge } from "../components/primitives/Badge";
import { Card, CardContent, CardHeader } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp, humanizeTimestamp } from "../time";
import { readToken } from "../token";
import type { AssistantBrief, BriefState, CalendarEvent, ProjectBrief, SportsEvent } from "../types";

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

const NOT_CONNECTED: Record<string, string> = {
  calendar: "Calendar isn't connected. Set GOOGLE_CALENDAR_ICS_URL to your calendar's secret iCal address.",
  projects: "No project status yet. Schedule scripts/push_project_status.py on your workspace machine.",
};

function SectionState({ state, name }: { state: BriefState; name: string }) {
  if (state === "ok") return null;
  const message =
    state === "not_connected" ? NOT_CONNECTED[name] ?? "Not connected."
    : state === "stale" ? "Showing the last push; it is more than a few hours old."
    : "Couldn't load this right now.";
  return <p role="status" className="muted">{message}</p>;
}

function eventLine(e: CalendarEvent) {
  return `${e.all_day ? "All day" : clock(e.start)} · ${e.title}${e.location ? ` (${e.location})` : ""}`;
}

function gameLine(e: SportsEvent) {
  const side = (name: string, rank: number | null) => (rank ? `#${rank} ${name}` : name);
  const live = e.status === "live" ? " · live" : "";
  return `${side(e.away, e.away_rank)} @ ${side(e.home, e.home_rank)} · ${centralTimestamp(e.start_at)}${live}`;
}

function GameList({ label, games }: { label: string; games: SportsEvent[] }) {
  if (games.length === 0) return null;
  return (
    <>
      <h3 className="eyebrow">{label}</h3>
      <ul aria-label={label}>
        {games.map((g) => (
          <li key={g.id}>{g.url ? <a href={g.url} target="_blank" rel="noopener noreferrer">{gameLine(g)}</a> : gameLine(g)}</li>
        ))}
      </ul>
    </>
  );
}

function ProjectItem({ p }: { p: ProjectBrief }) {
  const dirty = p.worktrees.reduce((n, w) => n + w.dirty_files, 0);
  return (
    <li>
      <strong>{p.folder}</strong>{" "}
      {p.reasons.map((r) => <Badge key={r} tone="warning">{r}</Badge>)}
      <div className="muted">
        {p.last_activity_at ? `Last commit ${humanizeTimestamp(p.last_activity_at)}` : "No commits"}
        {dirty > 0 && ` · ${dirty} uncommitted file${dirty === 1 ? "" : "s"}`}
        {p.worktrees.length > 1 && ` · ${p.worktrees.length} worktrees`}
      </div>
      {p.note && (
        <div>
          Left off on <code>{p.note.branch}</code>: {p.note.text.split("\n").slice(0, 2).join(" · ")}
          {p.other_notes > 0 && <span className="muted"> (+{p.other_notes} more)</span>}
        </div>
      )}
    </li>
  );
}

function Brief({ data }: { data: AssistantBrief }) {
  const { calendar, projects, games, gym } = data;
  const needs = projects.projects.filter((p) => p.reasons.length > 0);
  const recent = projects.projects.filter((p) => p.reasons.length === 0).slice(0, 5);
  return (
    <div className="app-grid">
      <Card>
        <CardHeader><h2>Today</h2></CardHeader>
        <CardContent>
          <SectionState state={calendar.state} name="calendar" />
          {calendar.state === "ok" && (calendar.events.length === 0
            ? <p className="muted">Nothing on the calendar.</p>
            : <ul aria-label="Today's events">{calendar.events.map((e) => <li key={e.start + e.title}>{eventLine(e)}</li>)}</ul>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2>Games</h2></CardHeader>
        <CardContent>
          {!games.configured && <p role="status" className="muted">No sports provider is configured.</p>}
          <GameList label="Your teams" games={games.priority} />
          <GameList label="Top 25" games={games.top_25} />
          <GameList label="NFL today" games={games.slate.NFL} />
          <GameList label="NBA today" games={games.slate.NBA} />
          {games.configured && games.priority.length + games.top_25.length + games.slate.NFL.length + games.slate.NBA.length === 0 && (
            <p className="muted">No games today.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2>Projects</h2></CardHeader>
        <CardContent>
          <SectionState state={projects.state} name="projects" />
          {needs.length > 0 && (<><h3 className="eyebrow">Needs you</h3><ul aria-label="Needs you">{needs.map((p) => <ProjectItem key={p.folder} p={p} />)}</ul></>)}
          {recent.length > 0 && (<><h3 className="eyebrow">Recently worked on</h3><ul aria-label="Recently worked on">{recent.map((p) => <ProjectItem key={p.folder} p={p} />)}</ul></>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2>Gym</h2></CardHeader>
        <CardContent>
          {gym.data?.next_gym_day ? (
            <p>Next up: <strong>{gym.data.next_gym_day.name}</strong>
              {gym.data.last_session_date && <span className="muted"> · last session {gym.data.last_session_date}</span>}</p>
          ) : (
            <p className="muted">{gym.state === "ok" ? "No routine yet." : gym.state === "fetch_failed" ? "Gym Tracker didn't respond." : "Gym Tracker isn't connected."}</p>
          )}
          {gym.data && gym.data.exercises.length > 0 && (
            <ul aria-label="Recent bests">
              {gym.data.exercises.map((x) => x.best_30d && (
                <li key={x.id}>{x.name}: best {x.best_30d.weight_lb} lb × {x.best_30d.reps_done} (30 days)</li>
              ))}
            </ul>
          )}
          {gym.app_url && <a href={gym.app_url} target="_blank" rel="noopener noreferrer">Log today's workout →</a>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Assistant() {
  const token = readToken();
  const { data, loading, refreshing, error, reload } = useAsyncData(
    useCallback(() => fetchAssistant(token), [token]),
  );
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Today's calendar, your teams' games, which projects need you and where you left off, and gym progress."
        lastUpdated={data ? centralTimestamp(data.generated_at) : undefined}
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing || !token}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view your brief." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <RefreshOverlay refreshing={refreshing} label="Refreshing brief">
          <LoadingBoundary
            loading={loading}
            hasData={Boolean(data)}
            label="Loading brief"
            skeleton={<SkeletonStack rows={4} rowHeight={120} />}
            empty={<EmptyState message="No brief available." />}
          >
            {data && <Brief data={data} />}
          </LoadingBoundary>
        </RefreshOverlay>
      )}
    </>
  );
}
