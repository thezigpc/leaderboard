// Season boards: a points table whose columns are nights. A night is another board here (any
// format: its standings' places count) or results typed or pasted in (a trivia game's night).
// Entrants are matched by name across nights (case and spacing don't matter), and the season's
// aliases join spellings that are the same team ("Quizards" → "Quizzards").

import { nameKey } from "./actions.js";
import { derive } from "./derive.js";
import type { Board, SeasonLink, SeasonNight } from "./types.js";

/** A season board has something to sum. */
export const hasSeason = (b: Board): boolean => !!b.season && (b.season.boards.length > 0 || (b.season.nights?.length ?? 0) > 0);

/** One night's results, whichever way it came in. */
interface NightRows {
  title: string;
  at: number;
  rows: { name: string; place: number; value: number | null }[];
}

/** What a name counts as in this season (after its aliases). */
export function seasonName(s: SeasonLink, name: string): string {
  let n = name;
  // Aliases can chain (A → B, B → C); stop at a loop.
  for (let i = 0; i < 5; i++) {
    const to = s.aliases?.[nameKey(n)];
    if (!to || nameKey(to) === nameKey(n)) break;
    n = to;
  }
  return n;
}

/**
 * The board as the engines should see it: participants, rounds and scores filled in from the
 * nights, in date order. Boards that are missing are skipped. A board without a season comes
 * back unchanged.
 */
export function withSeason(b: Board, sources: (Board | undefined)[]): Board {
  if (b.format !== "points" || !b.season || !hasSeason(b)) return b;
  const s = b.season;
  const nights: (NightRows & { id: string })[] = [];
  b.season.boards.forEach((id, i) => {
    const src = sources[i];
    if (!src) return;
    const d = derive(src);
    nights.push({
      id: `s${i}`,
      title: shortTitle(src.startedAt ?? src.createdAt),
      at: src.startedAt ?? src.createdAt,
      rows: d.standings.map((r) => ({ name: r.name, place: r.place, value: typeof r.value === "number" ? r.value : null })),
    });
  });
  for (const n of s.nights ?? []) nights.push({ id: `n_${n.id}`, ...typedNight(n) });
  nights.sort((x, y) => x.at - y.at);

  const participants = new Map<string, { id: string; name: string }>();
  for (const p of b.participants) participants.set(nameKey(seasonName(s, p.name)), { id: p.id, name: p.name });
  const scores: Record<string, Record<string, number>> = {};
  for (const night of nights) {
    for (const row of night.rows) {
      if (row.place === 0) continue;
      const pts = s.scoring === "placement" ? (s.placePoints[row.place - 1] ?? 0) : (row.value ?? 0);
      const name = seasonName(s, row.name);
      const k = nameKey(name);
      if (!participants.has(k)) participants.set(k, { id: `s_${k.replace(/[^a-z0-9]+/g, "_")}`, name });
      const pid = participants.get(k)!.id;
      // Two spellings on the same night (before they were joined): the better one counts.
      const had = (scores[pid] ??= {})[night.id];
      scores[pid][night.id] = had === undefined ? pts : Math.max(had, pts);
    }
  }
  const rounds = nights.map((n) => ({ id: n.id, name: n.title }));
  return {
    ...b,
    participants: [...participants.values()].map((p) => ({ ...b.participants.find((x) => x.id === p.id), ...p })),
    scores,
    settings: { ...b.settings, points: { ...b.settings.points, scoring: "rounds", rounds: rounds.length ? rounds : b.settings.points.rounds } },
  };
}

function typedNight(n: SeasonNight): NightRows {
  return { title: n.title || shortTitle(n.at), at: n.at, rows: n.results.map((r) => ({ name: r.name, place: r.place, value: r.score ?? null })) };
}

function shortTitle(at: number): string {
  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Reads a night's results from pasted text, one team per line, best first:
 *   "1. Quizzards 42", "Quizzards, 42", "2) Brainiacs", "Brainiacs\t38".
 * A leading number is the place (ties may share it); a trailing number is the score. With
 * scores and no places, the higher score ranks first (equal scores share a place). With
 * neither, the order is the place.
 */
export function readNight(text: string, lowWins = false): { name: string; place: number; score?: number }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200);
  // A trailing number after a comma, a tab or "pts" is a score. After a plain space it may be
  // part of the name ("Table 6"), so it's a score only when every line ends in one.
  const parsed: { name: string; place?: number; score?: number; weak?: { name: string; score: number } }[] = [];
  for (const line of lines) {
    let rest = line;
    let place: number | undefined;
    const lead = /^(\d{1,3})(?:st|nd|rd|th)?\s*[.):\-–]?\s+(.*)$/i.exec(rest);
    if (lead && lead[2]) {
      place = Number(lead[1]);
      rest = lead[2];
    }
    let score: number | undefined;
    let weak: { name: string; score: number } | undefined;
    const strong = /^(.*?)(?:\s*[,;\t]\s*|\s{2,})(-?\d+(?:\.\d+)?)\s*(?:pts?|points)?$/i.exec(rest) ?? /^(.*?)\s+(-?\d+(?:\.\d+)?)\s*(?:pts?|points)$/i.exec(rest);
    if (strong && strong[1].trim()) {
      score = Number(strong[2]);
      rest = strong[1];
    } else {
      const w = /^(.*?)\s(-?\d+(?:\.\d+)?)$/.exec(rest);
      if (w && w[1].trim()) weak = { name: w[1], score: Number(w[2]) };
    }
    const name = clean(rest);
    if (!name || /^(place|rank|team|name)\b/i.test(name)) continue; // a header line
    parsed.push({ name, ...(place ? { place } : {}), ...(score !== undefined ? { score } : {}), ...(weak ? { weak } : {}) });
  }
  const allScored = parsed.length > 0 && parsed.every((r) => r.score !== undefined || r.weak);
  const rows = parsed.map((r) => (r.weak && allScored ? { name: clean(r.weak.name), place: r.place, score: r.weak.score } : { name: r.name, place: r.place, score: r.score }));
  const placed = rows.every((r) => r.place !== undefined);
  const scored = rows.every((r) => r.score !== undefined);
  if (!placed && scored && rows.length) {
    const sorted = [...rows].sort((x, y) => (lowWins ? x.score! - y.score! : y.score! - x.score!));
    return sorted.map((r) => ({ name: r.name, score: r.score, place: 1 + sorted.filter((o) => (lowWins ? o.score! < r.score! : o.score! > r.score!)).length }));
  }
  return rows.map((r, i) => ({ name: r.name, place: placed ? r.place! : i + 1, ...(r.score !== undefined ? { score: r.score } : {}) }));
}

const clean = (s: string) => s.replace(/[,;\t]+$/, "").replace(/\s+/g, " ").trim().slice(0, 60);
