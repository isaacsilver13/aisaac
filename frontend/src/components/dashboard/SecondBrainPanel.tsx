import { useEffect, useState } from "react";
import { Brain } from "iconoir-react";
import { Link } from "react-router-dom";

import { fetchSecondBrainSummary } from "../../api";
import { readToken } from "../../token";
import type { SecondBrainSummary } from "../../types";
import { Badge } from "../primitives/Badge";
import { Card } from "../primitives/Card";
import { obsidianUrl } from "./secondBrain";

/** One-line vault status. Needs the same dashboard token as the financials panel; shows nothing until set. */
export function SecondBrainPanel() {
  const [token] = useState(readToken);
  const [summary, setSummary] = useState<SecondBrainSummary | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchSecondBrainSummary(token)
      .then((next) => !cancelled && setSummary(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!summary) return null;
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(summary.counts).map(([folder, n]) => `${n} ${folder}`).join(" · ");
  return (
    <Card aria-label="Second brain" className="second-brain-strip">
      <Brain width={16} height={16} aria-hidden="true" />
      <strong>{total} notes</strong>
      <span className="second-brain-strip-breakdown" title={summary.last_commit ?? undefined}>{breakdown}</span>
      {!!summary.drafts && <Badge tone="warning">{summary.drafts} drafts</Badge>}
      {!!summary.broken_links && <Badge tone="warning">{summary.broken_links} broken links</Badge>}
      <span className="second-brain-strip-links">
        <Link to="/knowledge">Browse</Link>
        <a href={obsidianUrl("Home.md")}>Obsidian</a>
      </span>
    </Card>
  );
}
