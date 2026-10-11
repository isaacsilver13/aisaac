import type { RepoActivity } from "../../types";

// All bucketing is in UTC because GitHub's stats weeks start Sunday 00:00 UTC.
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** yyyy-mm-dd (UTC) — the key format for days and weeks. */
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** yyyy-mm-dd -> yyyy/mm/dd, the dashboard's display format. */
export const displayDay = (key: string) => key.replaceAll("-", "/");

/** Sunday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  return day - new Date(day).getUTCDay() * DAY_MS;
}

/** The starts of the last `weeks` weeks, oldest first, ending with the current week. */
export function recentWeekStarts(weeks: number, now = Date.now()): number[] {
  const current = weekStart(now);
  return Array.from({ length: weeks }, (_, i) => current - (weeks - 1 - i) * WEEK_MS);
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Commits per UTC day summed across repos; only days with commits are present. */
export function dailyCommits(repos: RepoActivity[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const repo of repos) {
    for (const week of repo.commit_weeks) {
      const start = Date.parse(week.week);
      week.days.forEach((count, i) => {
        if (count > 0) {
          const key = isoDay(start + i * DAY_MS);
          totals.set(key, (totals.get(key) ?? 0) + count);
        }
      });
    }
  }
  return totals;
}

/**
 * Consecutive days with commits. `current` counts back from today, or from yesterday when
 * today has no commits yet, so the streak isn't shown as broken first thing in the morning.
 */
export function commitStreaks(daily: Map<string, number>, now = Date.now()): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const key of [...daily.keys()].sort()) {
    const ms = Date.parse(key);
    run = ms - previous === DAY_MS ? run + 1 : 1;
    previous = ms;
    longest = Math.max(longest, run);
  }

  let cursor = Math.floor(now / DAY_MS) * DAY_MS;
  if (!daily.has(isoDay(cursor))) cursor -= DAY_MS;
  let current = 0;
  while (daily.has(isoDay(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }
  return { current, longest };
}

export const OTHER_SERIES = "Other";

/**
 * Weekly commit rows for a stacked bar chart: one key per repo (most active first), with
 * repos past `maxSeries` folded into "Other" so the palette never cycles.
 */
export function weeklyCommitsByRepo(
  repos: RepoActivity[],
  weeks = 26,
  maxSeries = 6,
  now = Date.now(),
): { rows: Array<Record<string, number | string>>; series: string[] } {
  const starts = recentWeekStarts(weeks, now);
  const perRepo = repos
    .map((repo) => {
      const byWeek = new Map(repo.commit_weeks.map((w) => [Date.parse(w.week), sum(w.days)]));
      const counts = starts.map((start) => byWeek.get(start) ?? 0);
      return { name: repo.name, counts, total: sum(counts) };
    })
    .filter((repo) => repo.total > 0)
    .sort((a, b) => b.total - a.total);

  const shown = perRepo.slice(0, maxSeries);
  const folded = perRepo.slice(maxSeries);
  const rows = starts.map((start, i) => {
    const row: Record<string, number | string> = { week: isoDay(start) };
    for (const repo of shown) row[repo.name] = repo.counts[i];
    if (folded.length > 0) row[OTHER_SERIES] = sum(folded.map((repo) => repo.counts[i]));
    return row;
  });
  return { rows, series: [...shown.map((repo) => repo.name), ...(folded.length > 0 ? [OTHER_SERIES] : [])] };
}

/** PRs opened and merged per week over the last `weeks` weeks. */
export function weeklyPullRequests(
  repos: RepoActivity[],
  weeks = 12,
  now = Date.now(),
): Array<{ week: string; opened: number; merged: number }> {
  const starts = recentWeekStarts(weeks, now);
  const index = new Map(starts.map((start, i) => [start, i]));
  const rows = starts.map((start) => ({ week: isoDay(start), opened: 0, merged: 0 }));
  for (const pr of repos.flatMap((repo) => repo.pull_request_history)) {
    const opened = index.get(weekStart(Date.parse(pr.opened_at)));
    if (opened !== undefined) rows[opened].opened += 1;
    if (pr.merged_at) {
      const merged = index.get(weekStart(Date.parse(pr.merged_at)));
      if (merged !== undefined) rows[merged].merged += 1;
    }
  }
  return rows;
}

/** Median hours from open to merge for PRs merged in the last `days` days, or null. */
export function medianHoursToMerge(repos: RepoActivity[], days = 84, now = Date.now()): number | null {
  const since = now - days * DAY_MS;
  const hours = repos
    .flatMap((repo) => repo.pull_request_history)
    .filter((pr) => pr.merged_at && Date.parse(pr.merged_at) >= since)
    .map((pr) => (Date.parse(pr.merged_at as string) - Date.parse(pr.opened_at)) / 3_600_000)
    .sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}

/** Share of code bytes per language across repos, largest first, the tail folded into "Other". */
export function languageShares(repos: RepoActivity[], top = 6): Array<{ language: string; share: number }> {
  const bytes = new Map<string, number>();
  for (const repo of repos) {
    for (const [language, count] of Object.entries(repo.languages)) {
      bytes.set(language, (bytes.get(language) ?? 0) + count);
    }
  }
  const total = sum([...bytes.values()]);
  if (total === 0) return [];
  const sorted = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  const shares = sorted.slice(0, top).map(([language, count]) => ({ language, share: count / total }));
  const rest = sum(sorted.slice(top).map(([, count]) => count));
  return rest > 0 ? [...shares, { language: OTHER_SERIES, share: rest / total }] : shares;
}
