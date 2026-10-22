import { drag } from "d3-drag";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { NoteRef, VaultGraph } from "../../types";
import { noteHref } from "../dashboard/secondBrain";
import { neighbors, searchMatches } from "./graphLayout";

const SIZE = { w: 800, h: 480 };

type SimNode = NoteRef & SimulationNodeDatum;
type SimLink = { source: string | SimNode; target: string | SimNode };

/**
 * Interactive force graph. React owns the elements (classes, visibility); d3 owns their
 * positions (updated imperatively on every tick) and the drag/zoom behaviour.
 * With `current` set it is the compact local graph: all labels, no controls, no zoom (so the page still scrolls).
 * `href` maps a node to its link (default: the note's article page).
 */
export function Graph({
  graph,
  current,
  href = noteHref,
}: {
  graph: VaultGraph;
  current?: string;
  href?: (path: string) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const compact = current !== undefined;

  const folders = useMemo(() => [...new Set(graph.nodes.map((n) => n.folder))].sort(), [graph]);
  const matches = useMemo(() => searchMatches(graph.nodes, query), [graph, query]);
  const lit = useMemo(
    () => (hovered ? neighbors(graph.edges, hovered) : matches.size ? matches : null),
    [graph, hovered, matches],
  );
  const folderOf = useMemo(() => new Map(graph.nodes.map((n) => [n.path, n.folder])), [graph]);
  const isHidden = (path: string) => off.has(folderOf.get(path) ?? "");

  useEffect(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g) return;
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = graph.edges.map(([source, target]) => ({ source, target }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.path).distance(compact ? 90 : 30))
      .force("charge", forceManyBody().strength(compact ? -350 : -60))
      .force("x", forceX(SIZE.w / 2).strength(0.08))
      .force("y", forceY(SIZE.h / 2).strength(0.08))
      .force("collide", forceCollide(compact ? 14 : 9));

    const root = select(g);
    const draw = () => {
      root.selectAll<SVGLineElement, SimLink>("line").data(links)
        .attr("x1", (d) => (d.source as SimNode).x ?? 0).attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0).attr("y2", (d) => (d.target as SimNode).y ?? 0);
      root.selectAll<SVGCircleElement, SimNode>("circle").data(nodes)
        .attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      root.selectAll<SVGTextElement, SimNode>("text").data(nodes)
        .attr("x", (d) => (d.x ?? 0) + 8).attr("y", (d) => (d.y ?? 0) + 3);
    };
    const zoomer = zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on("zoom", (e) => root.attr("transform", e.transform.toString()));
    // Frame the whole graph once it has mostly settled.
    const fit = () => {
      const xs = nodes.map((n) => n.x ?? 0);
      const ys = nodes.map((n) => n.y ?? 0);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = Math.min(compact ? 2.5 : 1.5, 0.9 * Math.min(SIZE.w / Math.max(x1 - x0, 1), SIZE.h / Math.max(y1 - y0, 1)));
      const t = zoomIdentity.translate(SIZE.w / 2 - (k * (x0 + x1)) / 2, SIZE.h / 2 - (k * (y0 + y1)) / 2).scale(k);
      if (compact) root.attr("transform", t.toString());
      else select(svg).call(zoomer.transform, t);
    };
    let ticks = 0;
    sim.on("tick", () => {
      draw();
      if (++ticks === 100) fit();
    });
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      sim.stop();
      sim.tick(300);
      draw();
      fit();
    }

    root.selectAll<SVGCircleElement, SimNode>("circle").data(nodes).call(
      drag<SVGCircleElement, SimNode>()
        .container(g)
        .on("start", (e) => {
          if (!e.active) sim.alphaTarget(0.3).restart();
          e.subject.fx = e.subject.x;
          e.subject.fy = e.subject.y;
        })
        .on("drag", (e) => {
          e.subject.fx = e.x;
          e.subject.fy = e.y;
        })
        .on("end", (e) => {
          if (!e.active) sim.alphaTarget(0);
          e.subject.fx = null;
          e.subject.fy = null;
        }),
    );

    if (!compact) {
      select(svg).call(zoomer).on("dblclick.zoom", null);
    }
    return () => {
      sim.stop();
      if (!compact) select(svg).on(".zoom", null);
    };
  }, [graph, compact]);

  const toggle = (folder: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });
  const dim = (path: string) => (lit && !lit.has(path) ? " dim" : "");
  const showLabel = (path: string) => compact || (lit?.has(path) ?? false);

  return (
    <>
      {!compact && (
        <div className="kb-graph-controls">
          <input type="search" aria-label="Find a note" placeholder="Find a note" value={query} onChange={(e) => setQuery(e.target.value)} />
          {folders.map((f) => (
            <label key={f}>
              <input type="checkbox" checked={!off.has(f)} onChange={() => toggle(f)} />
              <span className={`kb-swatch swatch-${f}`} aria-hidden="true" />
              {f}
            </label>
          ))}
        </div>
      )}
      <svg ref={svgRef} className="kb-graph" viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} role="group" aria-label="Note graph">
        <g ref={gRef}>
          {graph.edges.map(([s, d]) => (
            <line
              key={`${s}>${d}`}
              className={lit && !(lit.has(s) && lit.has(d)) ? "dim" : undefined}
              style={isHidden(s) || isHidden(d) ? { display: "none" } : undefined}
            />
          ))}
          {graph.nodes.map((n) => (
            <Link
              key={n.path}
              to={href(n.path)}
              aria-label={n.title}
              onMouseEnter={() => setHovered(n.path)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(n.path)}
              onBlur={() => setHovered(null)}
            >
              <circle
                r={n.path === current ? 7 : 5}
                className={`node-${n.folder}${n.path === current ? " node-current" : ""}${dim(n.path)}`}
                style={isHidden(n.path) ? { display: "none" } : undefined}
              />
              <text style={showLabel(n.path) && !isHidden(n.path) ? undefined : { display: "none" }}>{n.title}</text>
            </Link>
          ))}
        </g>
      </svg>
    </>
  );
}
