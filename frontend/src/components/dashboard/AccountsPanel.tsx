import { useCallback, useState } from "react";

import { disconnectProvider, fetchOwn, startConnect } from "../../api";
import { useAsyncData } from "../../hooks/useAsyncData";
import { centralTimestamp } from "../../time";
import { readToken, readWriteToken } from "../../token";
import type { OwnItem } from "../../types";
import { Badge } from "../primitives/Badge";
import { EmptyState } from "../primitives/EmptyState";
import { LoadingBoundary } from "../primitives/LoadingBoundary";
import { SkeletonStack } from "../primitives/Skeleton";
import { Table, type Column } from "../primitives/Table";

const label = (p: string) => (p === "stockx" ? "StockX" : p === "ebay" ? "eBay" : p);
const money = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);

const columns: Column<OwnItem>[] = [
  {
    key: "title",
    header: "Item",
    sortValue: (i) => i.title,
    render: (i) => (i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.title}</a> : i.title),
  },
  { key: "provider", header: "Account", sortValue: (i) => i.provider, render: (i) => label(i.provider) },
  { key: "kind", header: "Type", sortValue: (i) => i.kind, render: (i) => <Badge tone="info">{i.kind}</Badge> },
  { key: "price", header: "Price", align: "right", sortValue: (i) => i.price ?? 0, render: (i) => money(i.price) },
  { key: "when", header: "Date", sortValue: (i) => i.occurred_at ?? "", render: (i) => (i.occurred_at ? centralTimestamp(i.occurred_at) : "—") },
];

/** Connected eBay/StockX accounts and your own read-only purchases, watchlist, bids and listings. */
export function AccountsPanel() {
  const token = readToken();
  const { data, loading, error, reload } = useAsyncData(
    useCallback((force: boolean) => fetchOwn(token, force), [token]),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = Boolean(readWriteToken());

  async function connect(provider: string) {
    setActionError(null);
    try {
      window.location.assign(await startConnect(provider));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Connect failed.");
    }
  }

  async function disconnect(provider: string) {
    setActionError(null);
    try {
      await disconnectProvider(provider);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Disconnect failed.");
    }
  }

  if (!token) return null;
  if (error) return <p role="alert">{error}</p>;
  return (
    <LoadingBoundary
      loading={loading}
      hasData={Boolean(data)}
      label="Loading connected accounts"
      skeleton={<SkeletonStack rows={4} rowHeight={48} />}
      empty={<EmptyState message="No account data is available." />}
    >
      {data && (
        <section aria-label="Connected accounts">
          <h2>Your accounts</h2>
          <button type="button" className="refresh-button" onClick={() => void reload(true)}>
            Refresh accounts
          </button>
          {actionError && <p role="alert">{actionError}</p>}
          <ul>
            {data.connections.map((c) => (
              <li key={c.provider}>
                {label(c.provider)} · {c.connected ? "connected" : c.available ? "not connected" : "not set up"}{" "}
                {c.connected ? (
                  <button type="button" className="refresh-button" disabled={!canWrite} onClick={() => void disconnect(c.provider)} aria-label={`Disconnect ${label(c.provider)}`}>
                    Disconnect
                  </button>
                ) : (
                  <button type="button" className="refresh-button" disabled={!canWrite || !c.available} onClick={() => void connect(c.provider)} aria-label={`Connect ${label(c.provider)}`}>
                    Connect
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Table
            columns={columns}
            rows={data.items}
            rowKey={(i) => String(i.id)}
            searchText={(i) => `${i.title} ${i.provider}`}
            filters={[{ label: "Type", value: (i) => i.kind }]}
            emptyMessage="No account data yet. Connect an account to see purchases, watchlist and bids."
          />
        </section>
      )}
    </LoadingBoundary>
  );
}
