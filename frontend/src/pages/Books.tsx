import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { FinancialsAuthError, addBook, fetchBook, fetchBooks, recommendBooks, setBookStatus } from "../api";
import { Graph } from "../components/knowledge/Graph";
import { Badge } from "../components/primitives/Badge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { readToken, readWriteToken, writeToken } from "../token";
import type { Book, BookMap, BookRecommendation, BookRow, BookStatus, VaultGraph } from "../types";
import { Gate } from "./SecondBrain";

const STATUSES: BookStatus[] = ["queued", "listening", "done"];
const WRITE_HINT = "Add your write token in Settings";

/** Adapts a concept map to the knowledge Graph: node kind plays the folder (colour + legend toggle). */
const toVaultGraph = (map: BookMap): VaultGraph => ({
  nodes: map.nodes.map((n) => ({ path: n.id, title: n.label, folder: n.kind })),
  edges: map.edges.map((e) => [e.source, e.target]),
});

export default function Books() {
  const [token, setToken] = useState(readToken);
  const onAuthError = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);
  const [params] = useSearchParams();
  if (!token) return <Gate onToken={setToken} />;
  const bookId = Number(params.get("book"));
  return bookId ? (
    <BookView id={bookId} token={token} onAuthError={onAuthError} />
  ) : (
    <Library token={token} onAuthError={onAuthError} />
  );
}

function useGuard(onAuthError: () => void) {
  return useCallback(
    <T,>(call: Promise<T>) =>
      call.catch((err: unknown) => {
        if (err instanceof FinancialsAuthError) onAuthError();
        throw err;
      }),
    [onAuthError],
  );
}

function Library({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const guarded = useGuard(onAuthError);
  const books = useAsyncData(useCallback(() => guarded(fetchBooks(token)), [guarded, token]));
  const canWrite = Boolean(readWriteToken());
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(id: number, status: BookStatus) {
    setError(null);
    try {
      await setBookStatus(id, status);
      await books.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving failed.");
    }
  }

  const columns: Column<BookRow>[] = [
    { key: "title", header: "Title", sortValue: (b) => b.title, render: (b) => <Link to={`?book=${b.id}`}>{b.title}</Link> },
    { key: "author", header: "Author", sortValue: (b) => b.author, render: (b) => b.author },
    {
      key: "status",
      header: "Status",
      sortValue: (b) => b.status,
      render: (b) => (
        <select
          aria-label={`Status of ${b.title}`}
          value={b.status}
          disabled={!canWrite}
          title={canWrite ? undefined : WRITE_HINT}
          onChange={(e) => void changeStatus(b.id, e.target.value as BookStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ),
    },
    { key: "added", header: "Added", sortValue: (b) => b.added_at, render: (b) => b.added_at.slice(0, 10) },
    { key: "listen", header: "Listen", render: (b) => (b.apple_url ? <a href={b.apple_url} target="_blank" rel="noreferrer">Apple Books</a> : "") },
  ];

  return (
    <>
      <PageHeader
        title="Books"
        description="Audiobook recommendations and concept maps. Set a book to listening for a daily idea push (Settings)."
      />
      <Recommend canWrite={canWrite} onAdded={() => void books.reload()} />
      <section>
        <h2>Library</h2>
        {error && <p role="alert">{error}</p>}
        {books.error ? (
          <p className="muted">{books.error}</p>
        ) : (
          <Table
            columns={columns}
            rows={books.data ?? []}
            rowKey={(b) => String(b.id)}
            searchText={(b) => `${b.title} ${b.author}`}
            filters={[{ label: "Status", value: (b) => b.status }]}
            emptyMessage={books.loading ? "Loading…" : "No books yet. Ask for recommendations above and add one."}
          />
        )}
      </section>
    </>
  );
}

function Recommend({ canWrite, onAdded }: { canWrite: boolean; onAdded: () => void }) {
  const [interest, setInterest] = useState("");
  const [recs, setRecs] = useState<BookRecommendation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!interest.trim()) return;
    setStatus(null);
    setBusy("recommend");
    try {
      setRecs(await recommendBooks(interest.trim()));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Recommendations failed.");
    } finally {
      setBusy(null);
    }
  }

  async function add(rec: BookRecommendation) {
    setStatus(null);
    setBusy(rec.title);
    try {
      await addBook({ title: rec.title, author: rec.author, apple_url: rec.apple_url });
      setAdded((prev) => new Set(prev).add(rec.title));
      onAdded();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Adding failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <form onSubmit={(e) => void ask(e)} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label htmlFor="books-interest">What do you want to learn about?</label>
        <input
          id="books-interest"
          value={interest}
          maxLength={300}
          placeholder="decision making under uncertainty"
          onChange={(e) => setInterest(e.target.value)}
          style={{ flex: "1 1 240px" }}
        />
        <button type="submit" disabled={!canWrite || busy !== null} title={canWrite ? undefined : WRITE_HINT}>
          {busy === "recommend" ? "Finding audiobooks…" : "Recommend"}
        </button>
      </form>
      {status && <p role="status">{status}</p>}
      {recs && recs.length === 0 && <EmptyState message="No audiobook matches found. Try a broader interest." />}
      {recs && recs.length > 0 && (
        <ul className="book-recs" style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {recs.map((r) => (
            <li key={r.title}>
              <strong>{r.title}</strong> — {r.author}
              <p className="muted" style={{ margin: "4px 0" }}>{r.why}</p>
              <span style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                {r.apple_url && <a href={r.apple_url} target="_blank" rel="noreferrer">Apple Books</a>}
                <a href={r.audible_search_url} target="_blank" rel="noreferrer">Search Audible</a>
                <a href={r.libby_search_url} target="_blank" rel="noreferrer">Search Libby/OverDrive</a>
                <button
                  type="button"
                  onClick={() => void add(r)}
                  disabled={busy !== null || added.has(r.title)}
                  aria-label={`Add ${r.title}`}
                >
                  {added.has(r.title) ? "Added" : busy === r.title ? "Building map…" : "Add"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BookView({ id, token, onAuthError }: { id: number; token: string; onAuthError: () => void }) {
  const guarded = useGuard(onAuthError);
  const book = useAsyncData(useCallback(() => guarded(fetchBook(id, token)), [guarded, id, token]));
  if (book.error) return <EmptyState message={book.error} />;
  if (!book.data) return <EmptyState message="Loading…" />;
  return <ConceptMap book={book.data} />;
}

function ConceptMap({ book }: { book: Book }) {
  const [params] = useSearchParams();
  const graph = useMemo(() => toVaultGraph(book.map), [book]);
  const selected = book.map.nodes.find((n) => n.id === params.get("node"));
  const href = useCallback((node: string) => `?book=${book.id}&node=${encodeURIComponent(node)}`, [book.id]);
  return (
    <>
      <PageHeader title={book.title} description={`${book.author} · ${book.status}`} />
      <p>
        <Link to="/books">← Library</Link> <Badge tone="warning">AI-generated outline</Badge>
      </p>
      <p className="muted">Built from the model's knowledge of the book, not the audio; concepts may be wrong.</p>
      {graph.nodes.length === 0 ? (
        <EmptyState message="This book has no concept map." />
      ) : (
        <>
          <Graph graph={graph} href={href} />
          <Card style={{ marginTop: 12 }}>
            {selected ? (
              <>
                <Badge tone="info">{selected.kind}</Badge> <strong>{selected.label}</strong>
                <p>{selected.summary}</p>
              </>
            ) : (
              <p className="muted">Click a node to read its summary.</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
