import { Fragment, useCallback } from "react";

import { fetchApps, fetchDashboard, fetchDeployments } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { readToken } from "../../token";
import type { AppInfo, CheckResult, StackNode, StackNodeKind } from "../../types";
import { Card } from "../primitives/Card";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { StatusDot } from "../primitives/StatusDot";
import { STATE_TONE, type Tone } from "../primitives/tone";

const KIND_LABEL: Record<StackNodeKind, string> = {
  ui: "UI",
  api: "API",
  job: "Job",
  database: "Database",
  provider: "External provider",
};
// Request flow order: each tier calls the next.
const TIERS: StackNodeKind[][] = [["ui"], ["api", "job"], ["database", "provider"]];
const HEALTHY_PROVIDER = new Set(["ok", "up", "healthy", "fresh"]);

interface NodeHealth {
  tone: Tone;
  label: string;
  meta?: string;
}

/** Each node gets only the signal that actually probes it; signals are never merged (see CLAUDE.md). */
function nodeHealth(kind: StackNodeKind, r: CheckResult | undefined): NodeHealth {
  const notProbed = { tone: "neutral" as Tone, label: "not probed" };
  if (!r) return { tone: "neutral", label: "checking…" };
  switch (kind) {
    case "ui":
      return r.page_state ? { tone: STATE_TONE[r.page_state], label: r.page_state } : notProbed;
    case "api":
    case "job": {
      const meta = [r.response_ms === null ? null : `${Math.round(r.response_ms)} ms`, r.http_status && `HTTP ${r.http_status}`];
      return { tone: STATE_TONE[r.state], label: r.state, meta: meta.filter(Boolean).join(" · ") || undefined };
    }
    case "database":
      return r.readiness ? { tone: STATE_TONE[r.readiness], label: r.readiness, meta: "via readiness probe" } : notProbed;
    case "provider":
      return r.provider_state
        ? { tone: HEALTHY_PROVIDER.has(r.provider_state) ? "success" : "warning", label: r.provider_state }
        : notProbed;
  }
}

function nodeUrl(kind: StackNodeKind, app: AppInfo): string | null {
  if (kind === "ui") return app.product_url;
  if (kind === "api") return app.health_url;
  if (kind === "database") return app.readiness_url;
  return null;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Consecutive tiers whose nodes all share one host render inside one hosting boundary. */
function segments(nodes: StackNode[]): { host: string | null; tiers: StackNode[][] }[] {
  const out: { host: string | null; tiers: StackNode[][] }[] = [];
  for (const kinds of TIERS) {
    const tier = nodes.filter((n) => kinds.includes(n.kind));
    if (tier.length === 0) continue;
    const hosts = new Set(tier.map((n) => n.host));
    const host = hosts.size === 1 ? tier[0].host : null;
    const last = out[out.length - 1];
    if (host && last?.host === host) last.tiers.push(tier);
    else out.push({ host, tiers: [tier] });
  }
  return out;
}

function NodeBox({ node, app, result, showHost }: { node: StackNode; app: AppInfo; result?: CheckResult; showHost: boolean }) {
  const health = nodeHealth(node.kind, result);
  const url = nodeUrl(node.kind, app);
  return (
    <div className={`stack-node stack-node-${node.kind}`}>
      <div className="stack-node-head">
        <span className="stack-node-kind">{KIND_LABEL[node.kind]}</span>
        <span className="stack-node-health">
          <StatusDot tone={health.tone} label={`${node.name}: ${health.label}`} />
          {health.label}
        </span>
      </div>
      <strong>{node.name}</strong>
      <span className="stack-node-tech">{node.tech}</span>
      {node.detail && <span className="stack-node-detail">{node.detail}</span>}
      {showHost && node.host && <span className="stack-node-detail">Host · {node.host}</span>}
      {health.meta && <span className="stack-node-detail">{health.meta}</span>}
      {url && (
        <a className="stack-node-url" href={url} target="_blank" rel="noreferrer" title={url}>
          {shortUrl(url)}
        </a>
      )}
    </div>
  );
}

export function StackTab({ appId }: { appId: string }) {
  const apps = useAsyncData(fetchApps);
  const dashboard = useAsyncData(fetchDashboard);
  const token = readToken();
  const deploys = useAsyncData(useCallback(async () => (token ? fetchDeployments(appId, token) : null), [appId, token]));

  if (apps.error) return <ErrorState message={apps.error} onRetry={() => void apps.reload()} />;
  if (!apps.data) return null;
  const app = apps.data.find((a) => a.id === appId);
  if (!app?.stack) return <EmptyState message="No stack map is available for this application." />;

  const stack = app.stack;
  const result = dashboard.data?.results.find((r) => r.app_id === appId);
  const release = deploys.data?.releases[0];
  const hostLabel = (host: string) =>
    [stack.region ? `Fly · ${host}` : host, stack.region, host === app.fly_app && release ? `v${release.version}` : null]
      .filter(Boolean)
      .join(" · ");

  return (
    <section aria-labelledby="stack-map-heading">
      <div className="stack-tab-heading">
        <h2 id="stack-map-heading">Operational stack map</h2>
        <p>{stack.description}</p>
      </div>
      <Card className="stack-map">
        <div className="stack-flow" aria-label="Request flow">
          {segments(stack.nodes).map((segment, si) => (
            <Fragment key={si}>
              {si > 0 && <span className="stack-arrow" aria-hidden="true" />}
              <div className={segment.host ? "stack-host" : "stack-host stack-host-none"}>
                {segment.host && <div className="stack-host-label">{hostLabel(segment.host)}</div>}
                <div className="stack-host-tiers">
                  {segment.tiers.map((tier, ti) => (
                    <Fragment key={ti}>
                      {ti > 0 && <span className="stack-arrow" aria-hidden="true" />}
                      <div className={tier.length > 1 ? "stack-tier stack-tier-fan" : "stack-tier"}>
                        {tier.map((node) => (
                          <NodeBox key={node.name} node={node} app={app} result={result} showHost={!segment.host} />
                        ))}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        <div className="stack-monitoring">
          <span>AIsaac monitor</span>
          <strong>{stack.monitoring}</strong>
        </div>
      </Card>
    </section>
  );
}
