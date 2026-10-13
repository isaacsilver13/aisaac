import { useCallback, useState, type FormEvent } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { FinancialsAuthError, fetchGraph, fetchNote, fetchNotes, fetchPortals } from "../api";
import { noteHref } from "../components/dashboard/secondBrain";
import { Article } from "../components/knowledge/Article";
import { Graph } from "../components/knowledge/Graph";
import { neighborhood } from "../components/knowledge/graphLayout";
import { Landing, PortalPage } from "../components/knowledge/Portals";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { LoadingBoundary } from "../components/primitives/LoadingBoundary";
import { PageHeader } from "../components/primitives/PageHeader";
import { Skeleton, SkeletonStack } from "../components/primitives/Skeleton";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { readToken, writeToken } from "../token";
import type { NoteListItem, VaultGraph } from "../types";

const noteColumns: Column<NoteListItem>[] = [
  {
    key: "title",
    header: "Title",
    sortValue: (n) => n.title,
    render: (n) => <Link to={noteHref(n.path)}>{n.title}</Link>,
  },
  { key: "folder", header: "Folder", sortValue: (n) => n.folder, render: (n) => n.folder },
  { key: "status", header: "Status", sortValue: (n) => n.status ?? "", render: (n) => n.status ?? "—" },
];

type Guard = <T>(call: Promise<T>) => Promise<T>;

export function Gate({ onToken }: { onToken: (token: string) => void }) {
  const [draft, setDraft] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    writeToken(draft.trim());
    onToken(draft.trim());
  }
  return (
    <Card>
      <form className="token-form" onSubmit={submit}>
        <label className="ui-stat-label" htmlFor="sb-token">
          Access token for the second brain
        </label>
        <input
          id="sb-token"
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button className="refresh-button" type="submit">
          Unlock
        </button>
      </form>
    </Card>
  );
}

export default function SecondBrain() {
  const [token, setToken] = useState(readToken);
  const onAuthError = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);
  if (!token) return <Gate onToken={setToken} />;
  return <Vault token={token} onAuthError={onAuthError} />;
}

function Vault({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const guard = useCallback<Guard>(
    async (call) => {
      try {
        return await call;
      } catch (err) {
        if (err instanceof FinancialsAuthError) onAuthError();
        throw err;
      }
    },
    [onAuthError],
  );
  const notes = useAsyncData(useCallback(() => guard(fetchNotes(token)), [guard, token]));
  const portals = useAsyncData(useCallback(() => guard(fetchPortals(token)), [guard, token]));
  const graph = useAsyncData(useCallback(() => guard(fetchGraph(token)), [guard, token]));
  const splat = useParams()["*"] ?? "";
  const [params] = useSearchParams();

  const legacy = params.get("note");
  if (legacy) return <Navigate replace to={noteHref(legacy)} />;

  const error = notes.error ?? portals.error;
  if (error) return <EmptyState message={error} />;
  if (!notes.data || !portals.data) return <LoadingBoundary loading hasData={false} label="Loading knowledge base" skeleton={<><Skeleton height={150} /><div style={{ height: 12 }} /><SkeletonStack rows={5} rowHeight={44} /></>} empty={null}>{null}</LoadingBoundary>;

  if (!splat) return <Landing portals={portals.data} notes={notes.data} />;
  if (splat === "all") {
    return (
      <>
        <Link className="ui-stat-label" to="/knowledge">
          ← Portals
        </Link>
        <Table
          columns={noteColumns}
          rows={notes.data}
          rowKey={(n) => n.path}
          searchText={(n) => `${n.title} ${n.path} ${n.aliases.join(" ")}`}
          filters={[{ label: "Folder", value: (n) => n.folder }]}
          emptyMessage="No notes. Run scripts/second_brain_push.py."
        />
      </>
    );
  }
  if (splat === "graph") {
    return (
      <>
        <Link className="ui-stat-label" to="/knowledge">
          ← Portals
        </Link>
        <PageHeader title="Graph" description="Every note and the wikilinks between them." />
        {graph.error ? (
          <EmptyState message={graph.error} />
        ) : (
          <LoadingBoundary loading={graph.loading} hasData={Boolean(graph.data)} label="Loading knowledge graph" skeleton={<Skeleton height={420} />} empty={<EmptyState message="No graph data is available." />}>
            {graph.data && <Graph graph={graph.data} />}
          </LoadingBoundary>
        )}
      </>
    );
  }
  const portal = portals.data.find((p) => p.id === splat);
  if (portal) return <PortalPage portal={portal} notes={notes.data} />;
  // key: remount per article so a slow earlier response can't overwrite the newer one.
  return <ArticlePage key={splat} token={token} path={`${splat}.md`} guard={guard} graph={graph.data} />;
}

function ArticlePage({
  token,
  path,
  guard,
  graph,
}: {
  token: string;
  path: string;
  guard: Guard;
  graph: VaultGraph | null;
}) {
  const { data, loading, error } = useAsyncData(useCallback(() => guard(fetchNote(token, path)), [guard, token, path]));
  if (error) {
    return (
      <>
        <Link className="ui-stat-label" to="/knowledge">
          ← Portals
        </Link>
        <EmptyState message="No such article." />
      </>
    );
  }
  if (!data || data.path !== path) return <LoadingBoundary loading={loading} hasData={false} label="Loading article" skeleton={<><Skeleton height={44} /><div style={{ height: 12 }} /><Skeleton height={360} /></>} empty={<EmptyState message="No such article." />}>{null}</LoadingBoundary>;
  return (
    <>
      <Link className="ui-stat-label" to={`/knowledge/${data.portal}`}>
        ← {data.portal}
      </Link>
      <Article note={data} />
      {graph && neighborhood(graph, path).nodes.length > 1 && (
        <section>
          <h2>Local graph</h2>
          <Graph graph={neighborhood(graph, path)} current={path} />
        </section>
      )}
    </>
  );
}
