import { useCallback, useState } from "react";

import { FinancialsAuthError, fetchNbaReport } from "../api";
import { Badge } from "../components/primitives/Badge";
import { Card } from "../components/primitives/Card";
import { EmptyState } from "../components/primitives/EmptyState";
import { PageHeader } from "../components/primitives/PageHeader";
import { Table, type Column } from "../components/primitives/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { readToken, writeToken } from "../token";
import type { NbaGame, NbaPick, NbaReport as Report, NbaTrackRecord } from "../types";
import { Gate } from "./SecondBrain";

/** Real money stays off until targeted picks clear this (bet_watch PR #11). */
const GATE_CLV = 0.01;
const GATE_PICKS = 200;

const pct = (x: number | null, digits = 1) => (x === null ? "—" : `${(x * 100).toFixed(digits)}%`);
const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`.replace("-", "−"));
const game = (p: { away: string; home: string }) => `${p.away} @ ${p.home}`;

const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

const pickColumns: Column<NbaPick>[] = [
  { key: "game", header: "Game", sortValue: game, render: game },
  {
    key: "side",
    header: "Side",
    sortValue: (p) => p.team,
    render: (p) => (p.line === null ? `${p.team} ML` : `${p.team} ${signed(p.line)}`),
  },
  { key: "book", header: "Best book", sortValue: (p) => p.book, render: (p) => p.book },
  { key: "price", header: "Price", align: "right", sortValue: (p) => p.price_american, render: (p) => signed(p.price_american) },
  { key: "model", header: "Model %", align: "right", sortValue: (p) => p.model_prob, render: (p) => pct(p.model_prob) },
  { key: "market", header: "No-vig market %", align: "right", sortValue: (p) => p.market_prob, render: (p) => pct(p.market_prob) },
  { key: "ev", header: "EV", align: "right", sortValue: (p) => p.ev, render: (p) => pct(p.ev) },
  { key: "kelly", header: "Kelly % of bankroll", align: "right", sortValue: (p) => p.kelly_frac, render: (p) => pct(p.kelly_frac) },
];

export default function NbaReport() {
  const [token, setToken] = useState(readToken);
  const onAuthError = useCallback(() => {
    writeToken("");
    setToken("");
  }, []);
  if (!token) return <Gate onToken={setToken} />;
  return <ReportView token={token} onAuthError={onAuthError} />;
}

function ReportView({ token, onAuthError }: { token: string; onAuthError: () => void }) {
  const report = useAsyncData(
    useCallback(
      () =>
        fetchNbaReport(token).catch((err: unknown) => {
          if (err instanceof FinancialsAuthError) onAuthError();
          throw err;
        }),
      [token, onAuthError],
    ),
  );
  if (report.error) return <EmptyState message={report.error} />;
  if (report.loading) return <EmptyState message="Loading…" />;

  const r = report.data;
  const isToday = r?.slate_date === chicagoToday();
  return (
    <>
      <PageHeader
        title="NBA report"
        description="Model vs Illinois books. Only early moneylines have shown an edge; everything else is tracking only."
      />
      {!isToday && (
        <EmptyState message="No report yet today. bet_watch sends it after the 10:00 CT odds snapshot, about 10:15 CT." />
      )}
      {r && <ReportBody report={r} isToday={isToday} />}
    </>
  );
}

function ReportBody({ report, isToday }: { report: Report; isToday: boolean }) {
  const targeted = report.picks.filter((p) => p.tier === "targeted");
  const watchlist = report.picks.filter((p) => p.tier === "watchlist");
  const record = (tier: NbaTrackRecord["tier"]) => report.track_record.find((t) => t.tier === tier);
  return (
    <>
      <p className="muted">
        {isToday ? "Slate" : "Last report"} {report.slate_date} · odds as of {report.odds_as_of ?? "—"} · model{" "}
        {report.model_version} · data through {report.data_through ?? "—"}
      </p>
      <TrackRecord targeted={record("targeted")} watchlist={record("watchlist")} />

      <section>
        <h2>Targeted</h2>
        <p className="muted">Moneylines with EV over 3% after per-bet fees. Kelly is a fractional, capped share of bankroll.</p>
        {targeted.length === 0 ? (
          <EmptyState message="No edges today: no moneyline cleared EV > 3% after fees." />
        ) : (
          <Table columns={pickColumns} rows={targeted} rowKey={(p) => `${p.game_id}-${p.market}-${p.side}`} emptyMessage="No targeted bets." />
        )}
      </section>

      <section>
        <h2>Games</h2>
        {report.games.length === 0 ? (
          <p className="muted">No games on this slate.</p>
        ) : (
          report.games.map((g) => (
            <GameCard key={`${g.away}-${g.home}`} game={g} picks={report.picks.filter((p) => p.home === g.home && p.away === g.away)} />
          ))
        )}
      </section>

      <section>
        <h2>
          Watchlist <Badge tone="warning">Unproven — tracking only</Badge>
        </h2>
        <p className="muted">Spreads have shown no edge against the close. Logged to grade CLV; not a bet.</p>
        <Table columns={pickColumns} rows={watchlist} rowKey={(p) => `${p.game_id}-${p.market}-${p.side}`} emptyMessage="Nothing on the watchlist today." />
      </section>
    </>
  );
}

function GameCard({ game: g, picks }: { game: NbaGame; picks: NbaPick[] }) {
  const lean = (margin: number) => (margin >= 0 ? `${g.home} by ${margin.toFixed(1)}` : `${g.away} by ${(-margin).toFixed(1)}`);
  return (
    <Card>
      <details>
        <summary>
          <strong>{game(g)}</strong>
          {g.tip && <span className="muted"> · {new Date(g.tip).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          {picks.some((p) => p.tier === "targeted") && <Badge tone="success">Targeted</Badge>}
        </summary>
        <div className="metric-strip">
          <Stat label="Model margin" value={lean(g.pred_margin)} />
          <Stat
            label="Market spread"
            value={g.market_spread_home === null ? "No lines" : `${g.home} ${signed(g.market_spread_home)}`}
          />
          <Stat label={`${g.home} win, model`} value={pct(g.p_home_win)} />
          <Stat label={`${g.home} win, market`} value={pct(g.market_home_win_prob)} />
          <Stat label="Books" value={String(g.books)} />
        </div>
      </details>
    </Card>
  );
}

function TrackRecord({ targeted, watchlist }: { targeted?: NbaTrackRecord; watchlist?: NbaTrackRecord }) {
  const gateMet = !!targeted && targeted.avg_clv !== null && targeted.avg_clv >= GATE_CLV && targeted.clv_samples >= GATE_PICKS;
  return (
    <Card>
      <h2>Track record (targeted)</h2>
      {targeted ? (
        <div className="metric-strip">
          <Stat label="Picks" value={String(targeted.picks)} />
          <Stat label="Graded" value={String(targeted.graded)} />
          <Stat label="W-L-P" value={`${targeted.won}-${targeted.lost}-${targeted.push}`} />
          <Stat label="Avg CLV" value={targeted.avg_clv === null ? "—" : pct(targeted.avg_clv, 2)} />
          <Stat label="Beat close" value={targeted.beat_close_pct === null ? "—" : `${targeted.beat_close_pct.toFixed(0)}%`} />
        </div>
      ) : (
        <p className="muted">No track record yet.</p>
      )}
      <p>
        <Badge tone={gateMet ? "success" : "warning"}>{gateMet ? "Gate met" : "Gate not met"}</Badge> CLV ≥ +1% over{" "}
        {GATE_PICKS} targeted picks ({targeted?.clv_samples ?? 0}/{GATE_PICKS} with CLV so far). Until then, paper only.
      </p>
      {watchlist && (
        <p className="muted">
          Watchlist: {watchlist.picks} picks, {watchlist.won}-{watchlist.lost}-{watchlist.push}, avg CLV{" "}
          {watchlist.avg_clv === null ? "—" : pct(watchlist.avg_clv, 2)}.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value">{value}</span>
    </div>
  );
}
