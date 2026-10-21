import { useCallback, useState, type FormEvent } from "react";

import { FinancialsAuthError, fetchJournal, fetchPhilosophyToday, saveJournal } from "../api";
import { Badge } from "../components/primitives/Badge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { readToken, readWriteToken, writeToken } from "../token";
import type { JournalRow, PhilosophyToday } from "../types";
import { Gate } from "./SecondBrain";

const columns: Column<JournalRow>[] = [
  { key: "date", header: "Date", sortValue: (r) => r.local_date, render: (r) => r.local_date },
  { key: "author", header: "Author", sortValue: (r) => r.author ?? null, render: (r) => r.author ?? "" },
  { key: "theme", header: "Theme", render: (r) => r.theme ?? "" },
  { key: "intention", header: "Intention", render: (r) => r.intention ?? "" },
  { key: "reflection", header: "Reflection", render: (r) => r.reflection ?? "" },
];

export default function Philosophy() {
  const [token, setToken] = useState(readToken);
  const onAuthError = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);
  if (!token) return <Gate onToken={setToken} />;
  return <Practice token={token} onAuthError={onAuthError} />;
}

function Practice({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const guarded = useCallback(
    <T,>(call: Promise<T>) =>
      call.catch((err: unknown) => {
        if (err instanceof FinancialsAuthError) onAuthError();
        throw err;
      }),
    [onAuthError],
  );
  const today = useAsyncData(useCallback(() => guarded(fetchPhilosophyToday(token)), [guarded, token]));
  const history = useAsyncData(useCallback(() => guarded(fetchJournal(token)), [guarded, token]));

  if (today.error) return <EmptyState message={today.error} />;
  if (!today.data) return <EmptyState message="Loading…" />;
  const { entry } = today.data;

  return (
    <>
      <PageHeader title="Philosophy" description={`${today.data.date} · ${entry.theme}`} />
      <Card>
        <Badge tone="info">{entry.school}</Badge>
        {entry.paraphrase ? (
          <p className="philosophy-passage">
            <span className="ui-stat-label">In our words: </span>
            {entry.passage}
          </p>
        ) : (
          <blockquote className="philosophy-passage">{entry.passage}</blockquote>
        )}
        <p className="muted">
          — {entry.author}, {entry.source}
        </p>
      </Card>
      <JournalForm key={today.data.date} today={today.data} onSaved={() => void history.reload()} />
      <section>
        <h2>Journal</h2>
        {history.error ? (
          <p className="muted">{history.error}</p>
        ) : (
          <Table
            columns={columns}
            rows={history.data ?? []}
            rowKey={(r) => r.local_date}
            searchText={(r) => `${r.author} ${r.theme} ${r.intention} ${r.reflection}`}
            emptyMessage="No journal entries yet."
          />
        )}
      </section>
    </>
  );
}

function JournalForm({ today, onSaved }: { today: PhilosophyToday; onSaved: () => void }) {
  const [intention, setIntention] = useState(today.journal?.intention ?? "");
  const [reflection, setReflection] = useState(today.journal?.reflection ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const canWrite = Boolean(readWriteToken());

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    try {
      await saveJournal(today.date, { intention, reflection });
      setStatus("Saved.");
      onSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Saving failed.");
    }
  }

  return (
    <Card style={{ marginTop: 12 }}>
      <form onSubmit={(e) => void save(e)} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="philosophy-intention">Morning: {today.entry.morning_prompt}</label>
        <input
          id="philosophy-intention"
          value={intention}
          maxLength={1000}
          onChange={(e) => setIntention(e.target.value)}
        />
        <label htmlFor="philosophy-reflection">Evening: {today.entry.evening_question}</label>
        <textarea
          id="philosophy-reflection"
          rows={4}
          value={reflection}
          maxLength={5000}
          onChange={(e) => setReflection(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="submit" disabled={!canWrite} title={canWrite ? undefined : "Add your write token in Settings"}>
            Save
          </button>
          {status && <span role="status">{status}</span>}
        </div>
      </form>
    </Card>
  );
}
