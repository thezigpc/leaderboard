// Season boards: a points table whose columns are other boards (one per night).
// Entrants are matched by name across nights (case and spacing don't matter).

import { derive } from "./derive.js";
import type { Board } from "./types.js";

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The board as the engines should see it: participants, rounds and scores filled in from the
 * linked boards (in the order linked). Boards that are missing are skipped. A board without a
 * season link comes back unchanged.
 */
export function withSeason(b: Board, sources: (Board | undefined)[]): Board {
  if (b.format !== "points" || !b.season?.boards.length) return b;
  const s = b.season;
  const participants = new Map<string, { id: string; name: string }>();
  for (const p of b.participants) participants.set(key(p.name), { id: p.id, name: p.name });
  const rounds: { id: string; name: string }[] = [];
  const scores: Record<string, Record<string, number>> = {};
  sources.forEach((src, i) => {
    if (!src) return;
    const rid = `s${i}`;
    rounds.push({ id: rid, name: shortTitle(src) });
    const d = derive(src);
    for (const row of d.standings) {
      const pts = s.scoring === "placement" ? (row.place > 0 ? s.placePoints[row.place - 1] ?? 0 : 0) : typeof row.value === "number" ? row.value : 0;
      if (s.scoring === "placement" && row.place === 0) continue;
      const k = key(row.name);
      if (!participants.has(k)) participants.set(k, { id: `s_${k.replace(/[^a-z0-9]+/g, "_")}`, name: row.name });
      const pid = participants.get(k)!.id;
      (scores[pid] ??= {})[rid] = pts;
    }
  });
  return {
    ...b,
    participants: [...participants.values()].map((p) => ({ ...b.participants.find((x) => x.id === p.id), ...p })),
    scores,
    settings: { ...b.settings, points: { ...b.settings.points, scoring: "rounds", rounds: rounds.length ? rounds : b.settings.points.rounds } },
  };
}

function shortTitle(b: Board): string {
  const d = b.startedAt ?? b.createdAt;
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
