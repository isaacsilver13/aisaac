import { useCallback, useState, type FormEvent } from "react";
import { Refresh } from "iconoir-react";

import { archiveShoeWatch, createShoeWatch, fetchShoes } from "../api";
import { AccountsPanel } from "../components/dashboard/AccountsPanel";
import { Badge } from "../components/primitives/Badge";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp } from "../time";
import { readToken, readWriteToken } from "../token";
import type { ShoeListing, ShoeWatch } from "../types";

const STOCKX_SIZES = ["10", "10.5"];
const KIND_LABEL = { release: "release link", search: "search", stockx: "StockX price" };
const money = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);

export default function Shoes() {
  const token = readToken();
  const { data, loading, refreshing, error, reload } = useAsyncData(
    useCallback((force: boolean) => fetchShoes(token, force), [token]),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [kind, setKind] = useState<ShoeWatch["kind"]>("release");
  const canWrite = Boolean(readWriteToken());

  async function act(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed.");
    }
  }

  function add(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const formEl = ev.currentTarget;
    const form = new FormData(formEl);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    const cap = text("max_price");
    const watch = {
      kind: text("kind") as ShoeWatch["kind"],
      name: text("name"),
      keywords: text("keywords"),
      size: text("size") || null,
      condition: null,
      max_price: cap ? Number(cap) : null,
      url: text("url") || null,
    };
    void act(() => createShoeWatch(watch));
    formEl.reset();
  }

  const watchColumns: Column<ShoeWatch>[] = [
    {
      key: "name",
      header: "Watch",
      sortValue: (w) => w.name,
      render: (w) => (w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer">{w.name}</a> : w.name),
    },
    { key: "kind", header: "Type", sortValue: (w) => w.kind, render: (w) => <Badge tone="info">{KIND_LABEL[w.kind]}</Badge> },
    { key: "cap", header: "Max price", align: "right", sortValue: (w) => w.max_price ?? 0, render: (w) => money(w.max_price) },
    {
      key: "actions",
      header: "",
      render: (w) => (
        <button
          type="button"
          className="refresh-button"
          disabled={!canWrite}
          title={canWrite ? undefined : "Add your write token in Settings"}
          aria-label={`Archive ${w.name}`}
          onClick={() => void act(() => archiveShoeWatch(w.id))}
        >
          Archive
        </button>
      ),
    },
  ];

  const listingColumns: Column<ShoeListing>[] = [
    { key: "title", header: "Listing", sortValue: (l) => l.title, render: (l) => <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a> },
    { key: "price", header: "Price", align: "right", sortValue: (l) => l.price ?? 0, render: (l) => (l.prev_price !== null ? `${money(l.price)} (was ${money(l.prev_price)})` : money(l.price)) },
    { key: "source", header: "Source", sortValue: (l) => l.source, render: (l) => l.source },
    { key: "observed", header: "Observed", sortValue: (l) => l.observed_at, render: (l) => centralTimestamp(l.observed_at) },
  ];

  return (
    <>
      <PageHeader
        title="Shoes"
        description="Saved searches and official release links. Nothing is bought, bid on or signed into for you."
        lastUpdated={data?.freshness_at ? centralTimestamp(data.freshness_at) : undefined}
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing || !token}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view shoes." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <RefreshOverlay refreshing={refreshing} label="Refreshing shoes">
          <LoadingBoundary
            loading={loading}
            hasData={Boolean(data)}
            label="Loading shoes"
            skeleton={<SkeletonStack rows={6} rowHeight={52} />}
            empty={<EmptyState message="No shoe data is available." />}
          >
            {data && (
              <>
          {!data.configured && (
            <p role="status" className="muted">
              No listing provider is configured. Watches work as saved links; price tracking is off.
            </p>
          )}
          {actionError && <p role="alert">{actionError}</p>}
          <form onSubmit={add} aria-label="Add watch" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select name="kind" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as ShoeWatch["kind"])}>
              <option value="release">Release link</option>
              <option value="search">Search</option>
              <option value="stockx">StockX price</option>
            </select>
            <input name="name" aria-label="Name" placeholder="Name" required maxLength={120} />
            <input name="keywords" aria-label="Keywords" placeholder="Keywords" maxLength={200} />
            {kind === "stockx" ? (
              <select name="size" aria-label="Size" required defaultValue="10">
                {STOCKX_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input name="size" aria-label="Size" placeholder="Size" maxLength={20} size={6} />
            )}
            <input name="max_price" aria-label="Max price" placeholder="Max $" type="number" min={0} step="0.01" />
            <input name="url" aria-label="Link" placeholder="https://…" type="url" pattern="https?://.*" />
            <button type="submit" className="refresh-button" disabled={!canWrite} title={canWrite ? undefined : "Add your write token in Settings"}>
              Add watch
            </button>
          </form>
          <Table
            columns={watchColumns}
            rows={data.watches}
            rowKey={(w) => String(w.id)}
            searchText={(w) => `${w.name} ${w.keywords}`}
            emptyMessage="No watches yet."
          />
          {data.listings.length > 0 && (
            <Table
              columns={listingColumns}
              rows={data.listings}
              rowKey={(l) => String(l.id)}
              searchText={(l) => `${l.title} ${l.source}`}
              emptyMessage="No listings."
            />
          )}
          <AccountsPanel />
              </>
            )}
          </LoadingBoundary>
        </RefreshOverlay>
      )}
    </>
  );
}
