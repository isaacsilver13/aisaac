import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RepoActivity } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { axisTick, tooltipProps } from "./chartTheme";
import {
  OTHER_SERIES,
  dailyCommits,
  displayDay,
  isoDay,
  languageShares,
  medianHoursToMerge,
  recentWeekStarts,
  weeklyCommitsByRepo,
  weeklyPullRequests,
} from "./githubStats";

const legendStyle = { fontSize: 12, color: "var(--muted)" };
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
const seriesColor = (name: string, i: number) => (name === OTHER_SERIES ? "var(--neutral)" : SERIES[i % SERIES.length]);

/** "2026-10-04" -> "10/04" for axis ticks; tooltips show the full yyyy/mm/dd. */
const shortWeek = (key: string) => displayDay(key).slice(5);
const weekLabel = (key: unknown) => `Week of ${displayDay(String(key))}`;

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="ui-stat-label" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </Card>
  );
}

export function WeeklyCommitsChart({ repos, weeks = 12 }: { repos: RepoActivity[]; weeks?: number }) {
  const { rows, series } = weeklyCommitsByRepo(repos, weeks);
  return (
    <ChartCard title={`Commits per week, last ${weeks} weeks`}>
      {series.length === 0 ? (
        <EmptyState message="No commit history yet. GitHub computes it on first request; refresh in a minute." />
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="week" tickFormatter={shortWeek} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} />
              <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipProps} labelFormatter={weekLabel} />
              {series.length > 1 && <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />}
              {series.map((name, i) => (
                <Bar
                  key={name}
                  dataKey={name}
                  stackId="commits"
                  fill={seriesColor(name, i)}
                  stroke="var(--surface)"
                  strokeWidth={1}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function PullRequestChart({ repos, weeks = 12 }: { repos: RepoActivity[]; weeks?: number }) {
  const rows = weeklyPullRequests(repos, weeks);
  const median = medianHoursToMerge(repos, weeks * 7);
  const medianLabel = median === null ? "—" : median < 48 ? `${median.toFixed(1)} h` : `${(median / 24).toFixed(1)} d`;
  const empty = rows.every((row) => row.opened === 0 && row.merged === 0);
  return (
    <ChartCard title={`Pull requests, last ${weeks} weeks · median time to merge ${medianLabel}`}>
      {empty ? (
        <EmptyState message={`No pull requests opened or merged in the last ${weeks} weeks.`} />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="week" tickFormatter={shortWeek} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={16} />
              <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipProps} labelFormatter={weekLabel} />
              <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
              <Bar dataKey="opened" name="Opened" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="merged" name="Merged" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export function LanguagesChart({ repos }: { repos: RepoActivity[] }) {
  const rows = languageShares(repos).map((row) => ({ ...row, percent: Math.round(row.share * 1000) / 10 }));
  return (
    <ChartCard title="Languages, share of code">
      {rows.length === 0 ? (
        <EmptyState message="No language data reported." />
      ) : (
        <div style={{ height: Math.max(120, rows.length * 32) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
              <XAxis type="number" hide domain={[0, 100]} />
              <YAxis type="category" dataKey="language" tick={axisTick} tickLine={false} axisLine={false} width={88} />
              <Tooltip {...tooltipProps} formatter={(value) => [`${value}%`, "Share"]} />
              <Bar
                dataKey="percent"
                fill="var(--series-1)"
                radius={[0, 4, 4, 0]}
                barSize={14}
                label={{ position: "right", fill: "var(--muted)", fontSize: 11, formatter: (value: unknown) => `${value}%` }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

const HEATMAP_WEEKS = 53;

/** GitHub-style daily grid: one column per week, Sunday on top, darker = more commits. */
export function CommitHeatmap({ repos }: { repos: RepoActivity[] }) {
  const [now] = useState(Date.now);
  const grid = useRef<HTMLDivElement>(null);
  const daily = dailyCommits(repos);
  const max = Math.max(0, ...daily.values());
  const today = isoDay(now);
  const days = recentWeekStarts(HEATMAP_WEEKS, now).flatMap((start) =>
    Array.from({ length: 7 }, (_, i) => isoDay(start + i * 86_400_000)),
  );
  const total = [...daily.values()].reduce((a, b) => a + b, 0);
  // On narrow screens the grid scrolls; start at the most recent weeks, like GitHub does.
  useLayoutEffect(() => {
    if (grid.current) grid.current.scrollLeft = grid.current.scrollWidth;
  }, [total]);

  return (
    <ChartCard title={`Daily commits, last year · ${total} total`}>
      {max === 0 ? (
        <EmptyState message="No commit history yet. GitHub computes it on first request; refresh in a minute." />
      ) : (
        <div ref={grid} className="commit-heatmap" role="img" aria-label={`${total} commits in the last year, by day`}>
          {days.map((day) => {
            const count = daily.get(day) ?? 0;
            // Four steps of one hue (sequential), scaled to the busiest day.
            const level = count === 0 ? 0 : Math.ceil((count / max) * 4);
            return day > today ? (
              <span key={day} />
            ) : (
              <span key={day} className={`commit-heatmap-cell level-${level}`} title={`${displayDay(day)}: ${count} commit${count === 1 ? "" : "s"}`} />
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}
