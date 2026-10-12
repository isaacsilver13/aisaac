import { Clock } from "iconoir-react";

import { centralTimestamp } from "../time";
import type { AgentSummary } from "../types";
import { Badge } from "./primitives/Badge";
import { Card } from "./primitives/Card";

interface AgentCardProps {
  agent: AgentSummary;
}

function formatLastRun(value: string | null): string {
  if (!value) return "Never run";
  return centralTimestamp(value);
}

export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Card variant="interactive" className="agent-row">
      <div className="agent-row-main">
        <div className="agent-row-heading">
          <Badge tone="info">{agent.domain}</Badge>
          <h3>{agent.name}</h3>
        </div>
        <p className="agent-row-description">{agent.description}</p>
        {agent.scope.length > 0 && (
          <div className="agent-scope">
            {agent.scope.map((appId) => (
              <span className="agent-scope-tag" key={appId}>{appId}</span>
            ))}
          </div>
        )}
        {agent.last_run_note && <p className="agent-row-note">{agent.last_run_note}</p>}
      </div>
      <div className="agent-row-meta">
        <Clock width={14} height={14} aria-hidden="true" />
        <span>{formatLastRun(agent.last_run_at)}</span>
      </div>
    </Card>
  );
}
