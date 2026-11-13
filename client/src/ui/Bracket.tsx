// Brackets: an exact layout (every card's position is computed, not left to CSS), SVG
// connectors, and for the TV a "camera": the whole bracket when it fits at a readable size,
// otherwise zoomed in on the live matches, paging between groups of them.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BoardView, DerivedMatch } from "@leaderboard/shared";
import { namesOf, sideScore, slotName } from "./format";

const CARD_W = 260;
const CARD_H = 84;
const GAP_X = 52;
const ROW_H = CARD_H + 20;
const LABEL_H = 40;
const SECTION_GAP = 56;
const COL_W = CARD_W + GAP_X;

interface Placed {
  m: DerivedMatch;
  x: number;
  y: number; // top
}
interface Layout {
  cards: Placed[];
  labels: { x: number; y: number; text: string }[];
  links: string[];
  width: number;
  height: number;
}

const roundTitle = (m: DerivedMatch) => m.label;

export function layoutBracket(matches: DerivedMatch[]): Layout {
  const W = matches.filter((m) => m.section === "W");
  const L = matches.filter((m) => m.section === "L");
  const wRounds = Math.max(0, ...W.map((m) => m.round));
  const lRounds = Math.max(0, ...L.map((m) => m.round));
  const countW = (r: number) => W.filter((m) => m.round === r).length;
  const countL = (r: number) => L.filter((m) => m.round === r).length;
  const hW = Math.max(1, countW(1)) * ROW_H;
  const maxL = Math.max(0, ...Array.from({ length: lRounds }, (_, i) => countL(i + 1)));
  const hL = maxL * ROW_H;
  const topL = LABEL_H + hW + SECTION_GAP;
  const pos = new Map<string, Placed>();
  const labels: Layout["labels"] = [];

  for (let r = 1; r <= wRounds; r++) {
    const ms = W.filter((m) => m.round === r);
    const c = ms.length;
    ms.forEach((m) => pos.set(m.id, { m, x: (r - 1) * COL_W, y: LABEL_H + (hW * (m.index + 0.5)) / c - CARD_H / 2 }));
    if (ms[0]) labels.push({ x: (r - 1) * COL_W, y: 0, text: roundTitle(ms[0]) });
  }
  const finalW = W.find((m) => m.round === wRounds);
  const third = matches.find((m) => m.section === "3P");
  if (third && finalW) {
    const f = pos.get(finalW.id)!;
    pos.set(third.id, { m: third, x: f.x, y: f.y + ROW_H * 1.9 });
    labels.push({ x: f.x, y: f.y + ROW_H * 1.9 - LABEL_H, text: "Third place" });
  }
  for (let r = 1; r <= lRounds; r++) {
    const ms = L.filter((m) => m.round === r);
    const c = ms.length;
    ms.forEach((m) => pos.set(m.id, { m, x: (r - 1) * COL_W, y: topL + LABEL_H + (hL * (m.index + 0.5)) / c - CARD_H / 2 }));
    if (ms[0]) labels.push({ x: (r - 1) * COL_W, y: topL, text: roundTitle(ms[0]) });
  }
  const gf = matches.find((m) => m.section === "GF");
  const gf2 = matches.find((m) => m.section === "GF2");
  if (gf) {
    const col = Math.max(wRounds, lRounds);
    const a = finalW ? pos.get(finalW.id)!.y : LABEL_H;
    const lf = L.find((m) => m.round === lRounds);
    const b = lf ? pos.get(lf.id)!.y : a;
    const y = (a + b) / 2;
    pos.set(gf.id, { m: gf, x: col * COL_W, y });
    labels.push({ x: col * COL_W, y: y - LABEL_H - 6, text: "Grand final" });
    if (gf2 && gf2.state !== "skipped") {
      pos.set(gf2.id, { m: gf2, x: (col + 1) * COL_W, y });
      labels.push({ x: (col + 1) * COL_W, y: y - LABEL_H - 6, text: "Reset" });
    }
  }

  const visible = (m: DerivedMatch) => m.state !== "bye" && m.state !== "skipped";
  const cards = [...pos.values()].filter((p) => visible(p.m));
  const links: string[] = [];
  for (const p of cards) {
    if (!p.m.winnerTo) continue;
    const t = pos.get(p.m.winnerTo);
    if (!t || !visible(t.m)) continue;
    const x1 = p.x + CARD_W;
    const y1 = p.y + CARD_H / 2;
    const x2 = t.x;
    const y2 = t.y + CARD_H / 2;
    const xm = x2 - GAP_X / 2;
    links.push(`M${x1} ${y1}H${xm}V${y2}H${x2}`);
  }
  const width = Math.max(...cards.map((c) => c.x + CARD_W), CARD_W);
  const height = Math.max(...cards.map((c) => c.y + CARD_H), LABEL_H + CARD_H) + 8;
  return { cards, labels, links, width, height };
}

function MatchCard({ m, names, all, follow, flash }: { m: DerivedMatch; names: Map<string, string>; all: DerivedMatch[]; follow?: string; flash?: boolean }) {
  const side = (s: "a" | "b") => {
    const slot = m[s];
    const id = slot.kind === "player" ? slot.id : undefined;
    const won = !!id && m.winner === id && m.state === "done";
    const lost = !!id && m.state === "done" && m.winner !== id;
    return (
      <div className={`side ${won ? "won" : ""} ${lost ? "lost" : ""} ${slot.kind !== "player" ? "tbd" : ""} ${follow && id === follow ? "me" : ""}`}>
        <span className="who">{slotName(slot, names, all, true)}</span>
        <span className="score">{m.result?.forfeit ? (won ? "W/O" : "") : sideScore(m, s)}</span>
      </div>
    );
  };
  return (
    <div className={`match-card ${m.state} ${flash ? "flash" : ""}`}>
      {side("a")}
      {side("b")}
      {m.lane && m.state === "ready" && <span className="lane">{m.lane}</span>}
    </div>
  );
}

function BracketCanvas({ layout, view, follow, flashId, style, topEdge }: { layout: Layout; view: BoardView; follow?: string; flashId?: string; style?: CSSProperties; topEdge?: number }) {
  const names = useMemo(() => namesOf(view.board), [view.board]);
  return (
    <div className="bracket-canvas" style={{ width: layout.width, height: layout.height, ...style }}>
      <svg className="links" width={layout.width} height={layout.height}>
        {layout.links.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      {layout.labels.map((l, i) => (
        <div key={i} className="round-label" style={{ left: l.x, top: l.y, width: CARD_W }}>
          {l.text}
        </div>
      ))}
      {layout.cards.map((p) => (
        <div key={p.m.id} className={`card-pos ${topEdge !== undefined && p.y < topEdge ? "offcam" : ""}`} style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}>
          <MatchCard m={p.m} names={names} all={view.derived.matches} follow={follow} flash={flashId === p.m.id} />
        </div>
      ))}
    </div>
  );
}

/** The flash for a just-recorded result: for 6 s after the change. */
function useFlash(view: BoardView): string | undefined {
  const lc = view.board.lastChange;
  const [id, setId] = useState<string | undefined>();
  useEffect(() => {
    if (!lc?.matchId || Date.now() - lc.at > 15_000) return;
    setId(lc.matchId);
    const t = setTimeout(() => setId(undefined), 6000);
    return () => clearTimeout(t);
  }, [lc?.at, lc?.matchId]);
  return id;
}

/** On a phone: the bracket at a comfortable size, scrolled sideways. */
export function BracketScroll({ view, follow }: { view: BoardView; follow?: string }) {
  const layout = useMemo(() => layoutBracket(view.derived.matches), [view.derived.matches]);
  const flash = useFlash(view);
  const scale = 0.62;
  return (
    <div className="bracket-scroll">
      <div style={{ width: layout.width * scale, height: layout.height * scale }}>
        <BracketCanvas layout={layout} view={view} follow={follow} flashId={flash} style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

const MIN_FIT = 0.66;
const ZOOM = 1.05;
const PAGE_MS = 9000;

/** Groups the focus cards into camera pages that each fit the viewport. */
function pages(focus: Placed[], vw: number, vh: number): { x: number; y: number; w: number; h: number }[] {
  const sorted = [...focus].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const c of sorted) {
    const box = { x0: c.x, y0: c.y - LABEL_H, x1: c.x + CARD_W, y1: c.y + CARD_H };
    const cur = out.at(-1);
    if (cur) {
      const u = { x0: Math.min(cur.x0, box.x0), y0: Math.min(cur.y0, box.y0), x1: Math.max(cur.x1, box.x1), y1: Math.max(cur.y1, box.y1) };
      if (u.x1 - u.x0 <= vw && u.y1 - u.y0 <= vh) {
        out[out.length - 1] = u;
        continue;
      }
    }
    out.push(box);
  }
  return out.map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
}

/** On the TV: fit, or zoom to the live part and page through it. */
export function BracketTv({ view }: { view: BoardView }) {
  const layout = useMemo(() => layoutBracket(view.derived.matches), [view.derived.matches]);
  const flash = useFlash(view);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const fit = Math.min(size.w / layout.width, size.h / layout.height, 1.5);
  const zoomed = fit < MIN_FIT;

  const camPages = useMemo(() => {
    if (!zoomed) return [];
    const vw = size.w / ZOOM;
    const vh = size.h / ZOOM;
    const byId = new Map(layout.cards.map((c) => [c.m.id, c]));
    // The live part: matches ready to play, the ones they feed, and the latest result.
    const focusIds = new Set<string>();
    for (const c of layout.cards) {
      if (c.m.state !== "ready") continue;
      focusIds.add(c.m.id);
      if (c.m.winnerTo && byId.has(c.m.winnerTo)) focusIds.add(c.m.winnerTo);
    }
    const last = view.board.lastChange?.matchId;
    if (last && byId.has(last)) focusIds.add(last);
    if (!focusIds.size) {
      // Nothing to play: the final(s).
      for (const id of ["GF2", "GF", "3P"]) if (byId.has(id)) focusIds.add(id);
      const finals = layout.cards.filter((c) => c.m.section === "W").sort((a, b) => b.x - a.x)[0];
      if (finals) focusIds.add(finals.m.id);
    }
    const maxX = Math.max(0, layout.width - vw);
    const maxY = Math.max(0, layout.height - vh);
    return pages([...focusIds].map((id) => byId.get(id)!).filter(Boolean), vw, vh).map((p) => {
      // Center the page, keeping the camera inside the bracket…
      let cx = Math.min(Math.max(p.x + p.w / 2 - vw / 2, 0), maxX);
      let cy = Math.min(Math.max(p.y + p.h / 2 - vh / 2, 0), maxY);
      // …starting at a whole column (no half cards at the left edge)…
      const col = Math.floor(cx / COL_W) * COL_W;
      cx = p.x + p.w <= col + vw ? col : Math.min(maxX, Math.ceil((p.x + p.w - vw) / COL_W) * COL_W);
      // …and not slicing a card along the top edge.
      // (Moving the edge can make a card in another column straddle it, so repeat.)
      for (let i = 0; i < 8; i++) {
        const cut = layout.cards.find((c) => c.y < cy && c.y + CARD_H > cy && c.x + CARD_W > cx && c.x < cx + vw);
        if (!cut) break;
        cy = p.y + p.h - (cut.y - 10) <= vh ? Math.max(0, cut.y - 10) : Math.min(maxY, cut.y + CARD_H + 6);
      }
      return { x: cx, y: cy };
    });
  }, [zoomed, size, layout, view.board.lastChange?.matchId]);

  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    if (camPages.length < 2) return;
    const t = setInterval(() => setPage((p) => (p + 1) % camPages.length), PAGE_MS);
    return () => clearInterval(t);
  }, [camPages]);

  let transform: string;
  let topEdge: number | undefined;
  if (!zoomed) {
    const x = (size.w - layout.width * fit) / 2;
    const y = (size.h - layout.height * fit) / 2;
    transform = `translate(${x}px, ${y}px) scale(${fit})`;
  } else {
    const cam = camPages[Math.min(page, camPages.length - 1)] ?? { x: 0, y: 0 };
    transform = `scale(${ZOOM}) translate(${-cam.x}px, ${-cam.y}px)`;
    // A card the camera can't avoid slicing along the top fades out instead.
    topEdge = cam.y > 0 ? cam.y : undefined;
  }
  return (
    <div className="bracket-tv" ref={box}>
      <BracketCanvas layout={layout} view={view} flashId={flash} topEdge={topEdge} style={{ transform, transformOrigin: "0 0" }} />
      {zoomed && camPages.length > 1 && (
        <div className="cam-dots">
          {camPages.map((_, i) => (
            <span key={i} className={i === page ? "on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}
