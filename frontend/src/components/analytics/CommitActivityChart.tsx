import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RepoActivity } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { tooltipProps } from "./chartTheme";

interface CommitActivityChartProps {
  activity: RepoActivity[];
}

interface ChartDatum {
  name: string;
  commits: number;
}

export function CommitActivityChart({ activity }: CommitActivityChartProps) {
  const data: ChartDatum[] = activity
    .filter((item): item is RepoActivity & { commits_last_7d: number } => item.commits_last_7d !== null)
    .filter((item) => item.commits_last_7d > 0)
    .map((item) => ({ name: item.name, commits: item.commits_last_7d }))
    .sort((a, b) => b.commits - a.commits);

  return (
    <Card>
      <div className="ui-stat-label" style={{ marginBottom: 12 }}>Most active repos, last 7 days</div>
      {data.length === 0 ? (
        <EmptyState message="No commits in the last 7 days." />
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="commits" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
