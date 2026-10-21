import { useState, type FormEvent } from "react";

import { ConfigPanel } from "../components/ConfigPanel";
import { DailyPushes } from "../components/DailyPushes";
import { Card } from "../components/primitives/Card";
import { PageHeader } from "../components/primitives/PageHeader";
import { useTheme } from "../theme/useTheme";
import { readToken, readWriteToken, writeToken, writeWriteToken } from "../token";

export default function Settings() {
  const { theme, toggle } = useTheme();
  const [saved, setSaved] = useState(() => readToken() !== "");
  const [draft, setDraft] = useState("");
  const [writeSaved, setWriteSaved] = useState(() => readWriteToken() !== "");
  const [writeDraft, setWriteDraft] = useState("");

  function saveWrite(event: FormEvent) {
    event.preventDefault();
    if (!writeDraft.trim()) return;
    writeWriteToken(writeDraft.trim());
    setWriteDraft("");
    setWriteSaved(true);
  }

  function clearWrite() {
    writeWriteToken("");
    setWriteSaved(false);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    writeToken(draft.trim());
    setDraft("");
    setSaved(true);
  }

  function clear() {
    writeToken("");
    setSaved(false);
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="ui-stat-label" style={{ marginBottom: 8 }}>Access</div>
      <Card>
        <p style={{ margin: "0 0 12px" }}>
          The dashboard token unlocks Knowledge, financials, deployments and logs. It is stored in this browser only.
        </p>
        <form onSubmit={save} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            aria-label="Dashboard token"
            placeholder={saved ? "Token saved; enter a new one to replace it" : "Dashboard token"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit" disabled={!draft.trim()}>Save</button>
          {saved && <button type="button" onClick={clear}>Clear</button>}
        </form>
        <p className="ui-stat-label" style={{ marginTop: 12 }}>{saved ? "A token is saved." : "No token saved."}</p>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <p style={{ margin: "0 0 12px" }}>
          The write token lets this tab resolve incidents. It is kept for this browser tab only and
          is separate from the read token above.
        </p>
        <form onSubmit={saveWrite} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            aria-label="Dashboard write token"
            placeholder={writeSaved ? "Write token saved for this tab" : "Dashboard write token"}
            value={writeDraft}
            onChange={(e) => setWriteDraft(e.target.value)}
            autoComplete="off"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="submit" disabled={!writeDraft.trim()}>Save write token</button>
          {writeSaved && <button type="button" onClick={clearWrite}>Clear write token</button>}
        </form>
      </Card>

      {saved && (
        <>
          <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Backend configuration</div>
          <ConfigPanel token={readToken()} />
          <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Daily pushes</div>
          <DailyPushes token={readToken()} canWrite={writeSaved} />
        </>
      )}

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>GitHub connection</div>
      <Card>
        <p style={{ margin: "0 0 8px" }}>
          GitHub activity is read server-side. Its status appears as <strong>GitHub token</strong> in Backend configuration.
        </p>
        <p className="ui-stat-label" style={{ margin: 0, textTransform: "none", letterSpacing: 0 }}>
          Create a fine-grained, read-only token for the monitored repositories, then set it as the production <code>GITHUB_TOKEN</code> secret. Never paste it into this dashboard.
        </p>
      </Card>

      <div className="ui-stat-label" style={{ margin: "16px 0 8px" }}>Appearance</div>
      <Card>
        <button type="button" onClick={toggle}>Theme: {theme} (switch)</button>
      </Card>
    </>
  );
}
