import { centralTimestamp } from "../../time";
import type { CIEvent } from "../../types";
import { CiStatusBadge } from "../CiStatusBadge";

interface ComEventRowProps {
  event: CIEvent;
}

const formatReceivedAt = centralTimestamp;

export function ComEventRow({ event }: ComEventRowProps) {
  return (
    <li className="task-item">
      <CiStatusBadge status={event.ci_status} />
      <span>
        {event.repo} · {event.event_type}
      </span>
      {event.details && <span className="card-detail">{event.details}</span>}
      <span className="task-meta">
        {formatReceivedAt(event.received_at)}
        {!event.notified ? " · debounced" : ""}
      </span>
    </li>
  );
}
