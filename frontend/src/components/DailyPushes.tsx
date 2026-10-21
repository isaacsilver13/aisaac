import { useCallback, useState } from "react";

import { fetchPushPrefs, setPushPref } from "../api";
import { useAsyncData } from "../hooks/useAsyncData";
import { Card } from "./primitives/Card";
import { ErrorState } from "./primitives/ErrorState";

const label = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ");

/** One switch per daily ntfy push; all start off. Changing one needs the write token. */
export function DailyPushes({ token, canWrite }: { token: string; canWrite: boolean }) {
  const { data, error, reload } = useAsyncData(useCallback(() => fetchPushPrefs(token), [token]));
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Card>Loading…</Card>;

  async function toggle(kind: string, enabled: boolean) {
    setSaveError(null);
    setOverrides((o) => ({ ...o, [kind]: enabled }));
    try {
      await setPushPref(kind, enabled);
    } catch (err) {
      setOverrides((o) => ({ ...o, [kind]: !enabled }));
      setSaveError(err instanceof Error ? err.message : "Saving failed.");
    }
  }

  return (
    <Card>
      <p style={{ margin: "0 0 12px" }}>
        Each push goes to your phone via ntfy at most once a day, at or after the hour shown (Chicago time).
        {!canWrite && " Add the write token above to change these."}
      </p>
      {data.length === 0 && <p className="muted">No daily pushes are available yet.</p>}
      {data.map((p) => (
        <label key={p.kind} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={overrides[p.kind] ?? p.enabled}
            disabled={!canWrite}
            onChange={(e) => void toggle(p.kind, e.target.checked)}
          />
          {label(p.kind)} <span className="ui-stat-label">{String(p.hour).padStart(2, "0")}:00</span>
        </label>
      ))}
      {saveError && <p role="alert">{saveError}</p>}
    </Card>
  );
}
