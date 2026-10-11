import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import { Link } from "react-router-dom";

import { completeLearningModule, FinancialsAuthError, fetchGraph, fetchLearningModule } from "../api";
import { linkWikilinks, noteHref, obsidianUrl } from "../components/dashboard/secondBrain";
import { Graph } from "../components/knowledge/Graph";
import { neighborhood } from "../components/knowledge/graphLayout";
import { Badge } from "../components/primitives/Badge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { PageHeader } from "../components/primitives/PageHeader";
import { useAsyncData } from "../hooks/useAsyncData";
import { readToken, readWriteToken, writeToken } from "../token";
import type { LearningExercise, LearningModule } from "../types";
import { Gate } from "./SecondBrain";

export default function Learning() {
  const [token, setToken] = useState(readToken);
  const onAuthError = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);
  if (!token) return <Gate onToken={setToken} />;
  return <Module token={token} onAuthError={onAuthError} />;
}

function Module({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const guarded = useCallback(
    <T,>(call: Promise<T>) =>
      call.catch((err: unknown) => {
        if (err instanceof FinancialsAuthError) onAuthError();
        throw err;
      }),
    [onAuthError],
  );
  const mod = useAsyncData(useCallback(() => guarded(fetchLearningModule(token)), [guarded, token]));
  const graph = useAsyncData(useCallback(() => guarded(fetchGraph(token)), [guarded, token]));

  if (mod.error) return <EmptyState message={mod.error} />;
  if (!mod.data) return <EmptyState message="Loading…" />;
  const m = mod.data;
  const map = graph.data && neighborhood(graph.data, m.path);

  return (
    <>
      <PageHeader
        title="Daily learning"
        description={`${m.date} · ${m.title}`}
        actions={<CompleteButton module={m} />}
      />
      <section>
        <h2>Concept map</h2>
        {map && map.nodes.length > 1 ? (
          <Graph graph={map} current={m.path} />
        ) : (
          <p className="muted">{graph.error ?? (graph.data ? "This note has no links yet." : "Loading…")}</p>
        )}
      </section>
      <section className="wiki-body">
        <h2>Reading</h2>
        {m.reading.map((r) => (
          <div key={r.heading}>
            {r.heading && <h3>{r.heading}</h3>}
            <Markdown>{linkWikilinks(r.markdown, m.link_map)}</Markdown>
          </div>
        ))}
        <p>
          <Link to={noteHref(m.path)}>Read the full article</Link>
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <ol className="learning-list">
          {m.questions.map((q) => (
            <li key={q.prompt}>
              <p>{q.prompt}</p>
              <details>
                <summary>Show answer</summary>
                {q.answer}
              </details>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Exercises</h2>
        <ol className="learning-list">
          {m.exercises.map((e) => (
            <li key={e.prompt}>
              <Badge tone="info">{e.kind}</Badge> <Exercise exercise={e} path={m.path} />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Exercise({ exercise: e, path }: { exercise: LearningExercise; path: string }) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  if (e.kind === "reflect") {
    return (
      <span>
        {e.prompt} <a href={obsidianUrl(path)}>Open in Obsidian</a>
      </span>
    );
  }
  if (e.kind !== "match" || !e.pairs || !e.options) return <span>{e.prompt}</span>;
  return (
    <Card>
      <p>{e.prompt}</p>
      {e.pairs.map((p) => (
        <label key={p.path} className="learning-match">
          <strong>{p.term}</strong>
          <select value={picks[p.path] ?? ""} onChange={(ev) => setPicks({ ...picks, [p.path]: ev.target.value })}>
            <option value="">Choose a summary…</option>
            {e.options!.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {checked && <span aria-live="polite">{picks[p.path] === p.definition ? "✓ correct" : "✗ try again"}</span>}
        </label>
      ))}
      <button type="button" className="refresh-button" onClick={() => setChecked(true)}>
        Check
      </button>
    </Card>
  );
}

function CompleteButton({ module: m }: { module: LearningModule }) {
  const [doneAt, setDoneAt] = useState(m.completed_at);
  const [error, setError] = useState<string | null>(null);
  const canWrite = Boolean(readWriteToken());
  if (doneAt) return <Badge tone="success">Done</Badge>;
  async function complete() {
    setError(null);
    try {
      setDoneAt(await completeLearningModule(m.date, m.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving progress failed.");
    }
  }
  return (
    <>
      {error && <span role="alert">{error}</span>}
      <button
        type="button"
        className="refresh-button"
        disabled={!canWrite}
        title={canWrite ? undefined : "Add your write token in Settings"}
        onClick={() => void complete()}
      >
        Mark done
      </button>
    </>
  );
}
