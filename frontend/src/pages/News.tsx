import { useCallback, useState } from "react";
import { Bookmark, BookmarkSolid, Refresh, Xmark } from "iconoir-react";

import { fetchNews, setNewsState } from "../api";
import { EmptyState } from "../components/primitives/EmptyState";
import { ErrorState } from "../components/primitives/ErrorState";
import { LoadingBoundary, RefreshOverlay } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { SkeletonStack } from "../components/primitives/Skeleton";
import { useAsyncData } from "../hooks/useAsyncData";
import { centralTimestamp, humanizeTimestamp } from "../time";
import { readToken, readWriteToken } from "../token";
import type { NewsItem, NewsState } from "../types";

type View = "all" | "unread" | "saved";

export default function News() {
  const token = readToken();
  const { data, loading, refreshing, error, reload } = useAsyncData(
    useCallback((force: boolean) => fetchNews(token, force), [token]),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  // Optimistic state changes, so reading or saving never waits on a reload.
  const [overrides, setOverrides] = useState<Record<number, NewsState>>({});
  const [view, setView] = useState<View>("all");
  const [topic, setTopic] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const canWrite = Boolean(readWriteToken());

  async function mark(item: NewsItem, state: NewsState) {
    if (!canWrite) return;
    setActionError(null);
    setOverrides((o) => ({ ...o, [item.id]: state }));
    try {
      await setNewsState(item.id, state);
    } catch (e) {
      setOverrides((o) => ({ ...o, [item.id]: item.state }));
      setActionError(e instanceof Error ? e.message : "Update failed.");
    }
  }

  const items = (data?.items ?? [])
    .map((n) => ({ ...n, state: overrides[n.id] ?? n.state }))
    .filter((n) => n.state !== "dismissed");
  const unreadCount = items.filter((n) => n.state === "new").length;
  const savedCount = items.filter((n) => n.state === "saved").length;
  const needle = query.trim().toLowerCase();
  const visible = items.filter(
    (n) =>
      (view === "all" || (view === "unread" ? n.state === "new" : n.state === "saved")) &&
      (!topic || n.topic === topic) &&
      (!needle || `${n.title} ${n.source} ${n.topic}`.toLowerCase().includes(needle)),
  );
  const [lead, ...rest] = visible;
  const groups = new Map<string, NewsItem[]>();
  for (const n of rest) groups.set(n.topic, [...(groups.get(n.topic) ?? []), n]);

  const failing = data?.sources.filter((s) => s.last_error) ?? [];

  function story(item: NewsItem, isLead = false) {
    const unread = item.state === "new";
    const writeHint = canWrite ? undefined : "Add your write token in Settings";
    return (
      <article key={item.id} className={`news-card${isLead ? " news-lead" : ""}${unread ? "" : " news-read"}`}>
        <div className="news-meta">
          {unread && <span className="news-unread-dot" aria-label="Unread" />}
          {isLead && <span className="news-topic">{item.topic}</span>}
          <span>{item.source}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.published_at} title={centralTimestamp(item.published_at)}>
            {humanizeTimestamp(item.published_at)}
          </time>
        </div>
        <a
          className="news-headline"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => unread && void mark(item, "read")}
        >
          {item.title}
        </a>
        {isLead && <p className="news-why">{item.why}</p>}
        <div className="news-actions">
          <button
            type="button"
            className="news-action"
            disabled={!canWrite}
            title={writeHint}
            aria-pressed={item.state === "saved"}
            aria-label={item.state === "saved" ? `Unsave ${item.title}` : `Save ${item.title}`}
            onClick={() => void mark(item, item.state === "saved" ? "read" : "saved")}
          >
            {item.state === "saved" ? <BookmarkSolid width={16} height={16} /> : <Bookmark width={16} height={16} />}
          </button>
          <button
            type="button"
            className="news-action"
            disabled={!canWrite}
            title={writeHint}
            aria-label={`Dismiss ${item.title}`}
            onClick={() => void mark(item, "dismissed")}
          >
            <Xmark width={16} height={16} />
          </button>
        </div>
      </article>
    );
  }

  const chip = (active: boolean) => (active ? "coms-filter-chip active" : "coms-filter-chip");

  return (
    <>
      <PageHeader
        title="News"
        description="Source-linked reading picks ranked by recency and topic keywords. Headlines link to the publisher."
        lastUpdated={data?.freshness_at ? centralTimestamp(data.freshness_at) : undefined}
        actions={
          <button className="refresh-button" type="button" onClick={() => void reload(true)} disabled={refreshing || !token}>
            <Refresh width={16} height={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />
      {!token ? (
        <EmptyState message="Add your dashboard token in Settings to view news." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <RefreshOverlay refreshing={refreshing} label="Refreshing news">
          <LoadingBoundary
            loading={loading}
            hasData={Boolean(data)}
            label="Loading news"
            skeleton={<SkeletonStack rows={6} rowHeight={56} />}
            empty={<EmptyState message="No news data is available." />}
          >
            {data && <>
              {!data.freshness_at && <EmptyState message="No feed has refreshed successfully yet." />}
              {data.freshness_at && failing.length > 0 && (
                <p role="status" className="muted">
                  Showing last saved items; {failing.length} source{failing.length === 1 ? "" : "s"} failed to refresh:{" "}
                  {failing.map((s) => s.source).join(", ")}.
                </p>
              )}
              {actionError && <p role="alert">{actionError}</p>}
              <div className="news-toolbar">
                <div className="coms-filter-group" role="group" aria-label="Show">
                  {(
                    [
                      ["all", `All ${items.length}`],
                      ["unread", `Unread ${unreadCount}`],
                      ["saved", `Saved ${savedCount}`],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" className={chip(view === value)} aria-pressed={view === value} onClick={() => setView(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="coms-filter-group" role="group" aria-label="Topic">
                  {[null, ...data.topics].map((t) => (
                    <button key={t ?? "all"} type="button" className={chip(topic === t)} aria-pressed={topic === t} onClick={() => setTopic(t)}>
                      {t ?? "All topics"}
                    </button>
                  ))}
                </div>
                <input
                  className="news-search"
                  type="search"
                  placeholder="Search headlines"
                  aria-label="Search headlines"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {!lead ? (
                data.freshness_at && <EmptyState message="No articles match." />
              ) : (
                <>
                  {story(lead, true)}
                  {[...groups].map(([name, group]) => (
                    <section key={name} className="news-section" aria-label={name}>
                      <h2 className="news-section-title">
                        {name} <span>{group.length}</span>
                      </h2>
                      <div className="news-grid">
                        {group.map((n) => story(n))}
                      </div>
                    </section>
                  ))}
                </>
              )}
            </>}
          </LoadingBoundary>
        </RefreshOverlay>
      )}
    </>
  );
}
