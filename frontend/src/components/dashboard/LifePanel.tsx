import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchShoes, fetchSports, getNews } from "../../api";
import { centralTimestamp } from "../../time";
import { readToken } from "../../token";
import type { NewsItem, ShoeListing, SportsEvent } from "../../types";
import { Card } from "../primitives/Card";

const DAY_MS = 24 * 60 * 60 * 1000;
const line = (e: SportsEvent) => `${e.away} at ${e.home}`;
const price = (l: ShoeListing) => (l.price === null ? "price n/a" : `$${l.price.toFixed(2)}`);

interface LifeSummary {
  games: SportsEvent[];
  news: NewsItem[];
  shoeChanges: ShoeListing[];
  watchCount: number;
}

/**
 * Sports, news and shoes at a glance, read from the stored snapshots behind the dashboard token.
 * Never triggers an upstream refresh; each page's own Refresh button does that. Hidden until a token is set.
 */
export function LifePanel() {
  const [token] = useState(readToken);
  const [life, setLife] = useState<LifeSummary | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void Promise.allSettled([fetchSports(token), getNews(token), fetchShoes(token)]).then(([sports, news, shoes]) => {
      // All three failing means a bad token or a down backend; stay hidden like the other token panels.
      if (cancelled || [sports, news, shoes].every((r) => r.status === "rejected")) return;
      const shoesData = shoes.status === "fulfilled" ? shoes.value : null;
      setLife({
        games: sports.status === "fulfilled" ? sports.value.priority : [],
        news: news.status === "fulfilled" ? news.value.items.filter((n) => n.state !== "dismissed") : [],
        shoeChanges: (shoesData?.listings ?? []).filter(
          (l) => l.changed_at && Date.now() - new Date(l.changed_at).getTime() < DAY_MS,
        ),
        watchCount: shoesData?.watches.length ?? 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!life) return null;
  return (
    <Card aria-label="Life" className="life-panel">
      <div className="ui-stat-label">Life</div>

      <section>
        <h3><Link to="/sports">Sports</Link></h3>
        {life.games.length === 0 ? (
          <p>No Chicago games scheduled.</p>
        ) : (
          <ul>
            {life.games.slice(0, 3).map((e) => (
              <li key={e.id}>{line(e)} · <span className="life-panel-meta">{centralTimestamp(e.start_at)}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3><Link to="/news">News</Link></h3>
        {life.news.length === 0 ? (
          <p>Nothing new.</p>
        ) : (
          <ul>
            {life.news.slice(0, 3).map((n) => (
              <li key={n.id}>
                <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>{" "}
                <span className="life-panel-meta">{n.source}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3><Link to="/shoes">Shoes</Link></h3>
        {life.shoeChanges.length === 0 ? (
          <p>{life.watchCount} watch{life.watchCount === 1 ? "" : "es"}, no price changes today.</p>
        ) : (
          <ul>
            {life.shoeChanges.slice(0, 3).map((l) => (
              <li key={l.id}>{l.title} · <span className="life-panel-meta">{price(l)}</span></li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
