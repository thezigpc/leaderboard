// Small display helpers shared by every page.

import { formatTime, type Board, type BoardView, type DerivedMatch, type PublicBoard, type SlotState } from "@leaderboard/shared";

export { formatTime };

/** "1:02.50" / "62.5" / "1m 2.5s" → seconds. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const colon = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const ms = /^(?:(\d+)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/i.exec(t);
  if (ms && (ms[1] || ms[2])) return Number(ms[1] ?? 0) * 60 + Number(ms[2] ?? 0);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function namesOf(b: Board | PublicBoard): Map<string, string> {
  return new Map(b.participants.map((p) => [p.id, p.name]));
}

/** A slot's name. `short` (bracket cards, where the lines show where winners come from):
 * only "Loser of …" for a slot waiting on a loser, nothing for one waiting on a winner. */
export function slotName(s: SlotState, names: Map<string, string>, all: DerivedMatch[], short = false): string {
  if (s.kind === "player") return names.get(s.id) ?? "?";
  if (s.kind === "bye") return "bye";
  const from = all.find((m) => m.id === s.from);
  if (!from) return "TBD";
  const several = all.filter((m) => m.section === from.section && m.round === from.round).length > 1;
  const name = several ? `${from.label} ${from.index + 1}` : from.label;
  if (short) {
    const brief = name.replace(/^Winners /, "W ").replace(/^Losers round /, "L round ").replace("semifinal", "semi");
    return s.loser ? `Loser of ${brief}` : "";
  }
  return s.loser ? `Loser of ${name}` : `Winner of ${name}`;
}

export const slotId = (s: SlotState): string | undefined => (s.kind === "player" ? s.id : undefined);

/** A number for a board's headline value (time, points…). */
export function valueText(view: BoardView, v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  if (view.board.format === "best" && view.board.settings.best.unit === "time") return formatTime(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function scoreText(m: DerivedMatch): string {
  const r = m.result;
  if (!r) return "";
  if (r.forfeit) return "W/O";
  if (r.scoreA === undefined || r.scoreB === undefined) return "";
  const aFirst = m.a.kind !== "player" || r.a === m.a.id;
  return aFirst ? `${r.scoreA}–${r.scoreB}` : `${r.scoreB}–${r.scoreA}`;
}

/** Score for one side of a match card. */
export function sideScore(m: DerivedMatch, side: "a" | "b"): string {
  const r = m.result;
  if (!r || r.scoreA === undefined || r.scoreB === undefined) return "";
  const slot = m[side];
  if (slot.kind !== "player") return "";
  return String(slot.id === r.a ? r.scoreA : r.scoreB);
}

export const isBracket = (b: Board | PublicBoard) => b.format === "single" || b.format === "double";

export function since(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
}
