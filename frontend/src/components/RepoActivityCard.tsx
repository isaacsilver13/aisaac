import { Link } from "react-router-dom";

import { centralTimestamp } from "../time";
import type { RepoActivity } from "../types";
import { CiStatusBadge } from "./CiStatusBadge";
import type { Column, TableFilter } from "./primitives/Table";

const formatTime = (value: string | null) => (value ? centralTimestamp(value) : "—");

export const repoColumns: Column<RepoActivity>[] = [
  {
    key: "name",
    header: "Repo",
    sortValue: (r) => r.name,
    render: (r) => (
      <>
        <Link className="repo-cell-name" to={`/github/repositories/${r.repo_id}`}>{r.name}</Link>
        <div className="repo-cell-path">{r.owner}/{r.repo}{r.private ? " · private" : ""}</div>
        {r.description && <div className="repo-cell-detail">{r.description}</div>}
        {r.detail && <div className="repo-cell-detail">{r.detail}</div>}
      </>
    ),
  },
  { key: "category", header: "Category", sortValue: (r) => r.category, render: (r) => r.category },
  { key: "language", header: "Language", sortValue: (r) => r.language ?? "", render: (r) => r.language ?? "—" },
  { key: "ci", header: "CI", sortValue: (r) => r.ci_status, render: (r) => <CiStatusBadge status={r.ci_status} /> },
  { key: "prs", header: "Open PRs", align: "right", sortValue: (r) => r.open_pr_count, render: (r) => r.open_pr_count ?? "—" },
  { key: "issues", header: "Open issues", align: "right", sortValue: (r) => r.open_issue_count, render: (r) => r.open_issue_count ?? "—" },
  { key: "commits", header: "Commits (7d)", align: "right", sortValue: (r) => r.commits_last_7d, render: (r) => r.commits_last_7d ?? "—" },
  { key: "pushed", header: "Last push", sortValue: (r) => r.pushed_at, render: (r) => formatTime(r.pushed_at) },
];

export const repoFilters: TableFilter<RepoActivity>[] = [
  { label: "Category", value: (r) => r.category },
  { label: "CI", value: (r) => r.ci_status },
  { label: "Language", value: (r) => r.language ?? "—" },
  { label: "Visibility", value: (r) => (r.private ? "private" : "public") },
];

export const repoSearchText = (r: RepoActivity) => `${r.name} ${r.owner}/${r.repo} ${r.category} ${r.language ?? ""} ${r.description ?? ""}`;
