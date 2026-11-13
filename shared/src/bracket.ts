// Single and double elimination, as pure functions.
//
// A bracket is a fixed "plan" built from the number of entrants: every match and where each
// of its two slots comes from (a seed, the winner of a match, or the loser of a match).
// Resolving the plan against the recorded results gives each match's players and state.
//
// Byes are ordinary values that flow through the plan: a slot can hold a BYE, a match
// with one BYE advances the other side without being played, and the BYE "loses" (so a
// double-elimination loser slot can receive a BYE too). Withdrawn players turn into BYEs
// at their next unplayed match. A result whose two players no longer match the slot
// (because an earlier result changed) is stale and ignored, which is how a bracket re-flows.

import type { DerivedMatch, MatchMeta, MatchResult, SlotState } from "./types.js";

export type Source = { seed: number } | { winnerOf: string } | { loserOf: string };

export interface PlanMatch {
  id: string;
  section: "W" | "L" | "GF" | "GF2" | "3P";
  round: number;
  index: number;
  label: string;
  a: Source;
  b: Source;
  winnerTo?: string;
  loserTo?: string;
}

export interface BracketPlan {
  kind: "single" | "double";
  size: number;
  /** Winners-bracket rounds (log2 of size). */
  rounds: number;
  /** Losers-bracket rounds (double only). */
  lRounds: number;
  matches: PlanMatch[];
  thirdPlace: boolean;
  bracketReset: boolean;
}

export const MAX_SINGLE = 128;
export const MAX_DOUBLE = 64;

/** Seed numbers (1-based) in bracket position order: 8 → [1,8,4,5,2,7,3,6]. Seeds 1 and 2
 * can only meet in the final; each seed's first opponent is the matching weakest seed. */
export function seedOrder(size: number): number[] {
  let order = [1];
  for (let s = 2; s <= size; s *= 2) order = order.flatMap((x) => [x, s + 1 - x]);
  return order;
}

export const bracketSize = (n: number): number => {
  let s = 2;
  while (s < n) s *= 2;
  return s;
};

/** The winners-bracket round in which seeds a and b (1-based) would meet if both kept winning. */
export function meetingRound(n: number, a: number, b: number): number {
  const order = seedOrder(bracketSize(Math.max(2, n)));
  const pa = order.indexOf(a);
  const pb = order.indexOf(b);
  let r = 1;
  while (pa >> r !== pb >> r) r++;
  return r;
}

/**
 * Keeps seeds a and b apart until the final: the seed to swap b with, the closest seed in
 * the other half of the bracket (never a bye, never a). Null when they're already apart.
 */
export function apartSwap(n: number, a: number, b: number): number | null {
  const size = bracketSize(Math.max(2, n));
  const rounds = Math.log2(size);
  if (rounds < 2 || meetingRound(n, a, b) === rounds) return null;
  const order = seedOrder(size);
  const half = (s: number) => (order.indexOf(s) < size / 2 ? 0 : 1);
  const other = 1 - half(a);
  let best: number | null = null;
  for (let s = 1; s <= n; s++) {
    if (s === a || s === b || half(s) !== other) continue;
    if (best === null || Math.abs(s - b) < Math.abs(best - b)) best = s;
  }
  return best;
}

const wId = (r: number, i: number) => `W${r}.${i}`;
const lId = (r: number, i: number) => `L${r}.${i}`;

function winnersRoundLabel(r: number, rounds: number, double: boolean): string {
  const fromEnd = rounds - r;
  const name = fromEnd === 0 ? "Final" : fromEnd === 1 ? "Semifinal" : fromEnd === 2 ? "Quarterfinal" : `Round ${r}`;
  if (!double) return name;
  return fromEnd === 0 ? "Winners final" : fromEnd === 1 ? "Winners semifinal" : `Winners round ${r}`;
}

/** Which winners-bracket match's loser drops into losers-bracket match i of a dropping round.
 * Alternating reversed and half-swapped orders keep players who just met apart. */
function dropFrom(i: number, count: number, wRound: number): number {
  if (count === 1) return 0;
  return wRound % 2 === 0 ? count - 1 - i : (i + count / 2) % count;
}

export function buildPlan(
  kind: "single" | "double",
  n: number,
  opts: { thirdPlace?: boolean; bracketReset?: boolean } = {},
): BracketPlan {
  const size = bracketSize(Math.max(2, n));
  const rounds = Math.log2(size);
  const double = kind === "double";
  const order = seedOrder(size);
  const matches: PlanMatch[] = [];

  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      matches.push({
        id: wId(r, i),
        section: "W",
        round: r,
        index: i,
        label: winnersRoundLabel(r, rounds, double),
        a: r === 1 ? { seed: order[2 * i] } : { winnerOf: wId(r - 1, 2 * i) },
        b: r === 1 ? { seed: order[2 * i + 1] } : { winnerOf: wId(r - 1, 2 * i + 1) },
      });
    }
  }

  let lRounds = 0;
  const thirdPlace = !double && !!opts.thirdPlace && rounds >= 2;
  if (thirdPlace) {
    matches.push({
      id: "3P",
      section: "3P",
      round: rounds,
      index: 1,
      label: "Third place",
      a: { loserOf: wId(rounds - 1, 0) },
      b: { loserOf: wId(rounds - 1, 1) },
    });
  }

  if (double) {
    lRounds = 2 * (rounds - 1);
    for (let lr = 1; lr <= lRounds; lr++) {
      const label = lr === lRounds ? "Losers final" : `Losers round ${lr}`;
      if (lr === 1) {
        for (let i = 0; i < size / 4; i++)
          matches.push({ id: lId(1, i), section: "L", round: 1, index: i, label, a: { loserOf: wId(1, 2 * i) }, b: { loserOf: wId(1, 2 * i + 1) } });
      } else if (lr % 2 === 0) {
        // A dropping round: the survivors meet the losers of winners round lr/2 + 1.
        const wRound = lr / 2 + 1;
        const count = size / 2 ** wRound;
        for (let i = 0; i < count; i++)
          matches.push({
            id: lId(lr, i),
            section: "L",
            round: lr,
            index: i,
            label,
            a: { winnerOf: lId(lr - 1, i) },
            b: { loserOf: wId(wRound, dropFrom(i, count, wRound)) },
          });
      } else {
        // A losers-only round: the survivors pair off.
        const count = size / 2 ** ((lr + 1) / 2 + 1);
        for (let i = 0; i < count; i++)
          matches.push({ id: lId(lr, i), section: "L", round: lr, index: i, label, a: { winnerOf: lId(lr - 1, 2 * i) }, b: { winnerOf: lId(lr - 1, 2 * i + 1) } });
      }
    }
    matches.push({
      id: "GF",
      section: "GF",
      round: 1,
      index: 0,
      label: "Grand final",
      a: { winnerOf: wId(rounds, 0) },
      b: lRounds > 0 ? { winnerOf: lId(lRounds, 0) } : { loserOf: wId(rounds, 0) },
    });
    if (opts.bracketReset) {
      // Played only when the losers-bracket champion wins the grand final; its slots are
      // filled from the grand final itself (see resolve).
      matches.push({ id: "GF2", section: "GF2", round: 2, index: 0, label: "Grand final reset", a: { winnerOf: "GF" }, b: { loserOf: "GF" } });
    }
  }

  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const m of matches) {
    if (m.section === "GF2") continue;
    for (const s of [m.a, m.b]) {
      if ("winnerOf" in s) byId.get(s.winnerOf)!.winnerTo = m.id;
      if ("loserOf" in s) byId.get(s.loserOf)!.loserTo = m.id;
    }
  }
  return { kind, size, rounds, lRounds, matches, thirdPlace, bracketReset: double && !!opts.bracketReset };
}

const BYE: SlotState = { kind: "bye" };
const player = (id: string): SlotState => ({ kind: "player", id });

/** True when a stored result belongs to these two players (in either order). */
export function resultFits(r: MatchResult | undefined, a: string, b: string): r is MatchResult {
  if (!r) return false;
  const same = (r.a === a && r.b === b) || (r.a === b && r.b === a);
  return same && (r.winner === a || r.winner === b);
}

export interface ResolvedBracket {
  matches: DerivedMatch[];
  byId: Map<string, DerivedMatch>;
  champion?: string;
  runnerUp?: string;
  complete: boolean;
  /** Stored results that no longer fit their match (an earlier result changed). */
  stale: string[];
}

/**
 * Resolves the plan: who plays in each match and what's been decided.
 * `seeds` are participant ids in seed order (seed 1 first).
 */
export function resolveBracket(
  plan: BracketPlan,
  seeds: string[],
  results: Record<string, MatchResult>,
  withdrawn: Set<string>,
  meta: Record<string, MatchMeta> = {},
): ResolvedBracket {
  const out: DerivedMatch[] = [];
  const byId = new Map<string, DerivedMatch>();
  const stale: string[] = [];
  const slotOf = (s: Source): SlotState => {
    if ("seed" in s) return s.seed <= seeds.length ? player(seeds[s.seed - 1]) : BYE;
    const from = byId.get("winnerOf" in s ? s.winnerOf : s.loserOf)!;
    if (from.state !== "done" && from.state !== "bye") return "loserOf" in s ? { kind: "pending", from: from.id, loser: true } : { kind: "pending", from: from.id };
    const id = "winnerOf" in s ? from.winner : from.loser;
    return id ? player(id) : BYE;
  };

  for (const p of plan.matches) {
    const m: DerivedMatch = {
      id: p.id,
      section: p.section,
      round: p.round,
      index: p.index,
      label: p.label,
      a: BYE,
      b: BYE,
      state: "waiting",
      winnerTo: p.winnerTo,
      loserTo: p.loserTo,
      lane: meta[p.id]?.lane,
      calledAt: meta[p.id]?.calledAt,
    };
    byId.set(p.id, m);
    out.push(m);

    if (p.section === "GF2") {
      // The reset: only when the grand final went to its b side (the losers-bracket champion).
      const gf = byId.get("GF")!;
      if (gf.state !== "done" && gf.state !== "bye") {
        m.a = { kind: "pending", from: "GF" };
        m.b = { kind: "pending", from: "GF" };
        if (results[p.id]) stale.push(p.id);
        continue;
      }
      const gfB = gf.b.kind === "player" ? gf.b.id : undefined;
      if (gf.state === "bye" || !gfB || gf.winner !== gfB) {
        m.state = "skipped";
        if (results[p.id]) stale.push(p.id);
        continue;
      }
      m.a = gf.a;
      m.b = gf.b;
    } else {
      m.a = slotOf(p.a);
      m.b = slotOf(p.b);
    }

    if (m.a.kind === "pending" || m.b.kind === "pending") {
      if (results[p.id]) stale.push(p.id);
      continue;
    }
    if (m.a.kind === "player" && m.b.kind === "player") {
      const r = results[p.id];
      if (resultFits(r, m.a.id, m.b.id)) {
        m.state = "done";
        m.result = r;
        m.winner = r.winner!;
        m.loser = r.winner === m.a.id ? m.b.id : m.a.id;
        continue;
      }
      if (r) stale.push(p.id);
      const outA = withdrawn.has(m.a.id);
      const outB = withdrawn.has(m.b.id);
      if (outA || outB) {
        // A walkover: the one still in goes through; a withdrawn player leaves the bracket
        // entirely (they don't drop to the losers bracket).
        m.state = "bye";
        m.winner = outA && outB ? undefined : outA ? m.b.id : m.a.id;
        continue;
      }
      m.state = "ready";
      continue;
    }
    // At least one BYE: advance the other side (unless they've withdrawn).
    if (results[p.id]) stale.push(p.id);
    m.state = "bye";
    const only = m.a.kind === "player" ? m.a.id : m.b.kind === "player" ? m.b.id : undefined;
    m.winner = only && !withdrawn.has(only) ? only : undefined;
  }

  // The champion.
  let champion: string | undefined;
  let runnerUp: string | undefined;
  if (plan.kind === "single") {
    const final = byId.get(wId(plan.rounds, 0))!;
    if (final.state === "done" || final.state === "bye") {
      champion = final.winner;
      runnerUp = final.loser;
    }
  } else {
    const gf = byId.get("GF")!;
    const gf2 = byId.get("GF2");
    if (gf.state === "bye") champion = gf.winner;
    else if (gf.state === "done") {
      const wentToB = gf.b.kind === "player" && gf.winner === gf.b.id;
      if (!wentToB || !gf2) {
        champion = gf.winner;
        runnerUp = gf.loser;
      } else if (gf2.state === "done") {
        champion = gf2.winner;
        runnerUp = gf2.loser;
      }
    }
  }
  const third = byId.get("3P");
  const complete = !!champion && (!third || third.state === "done" || third.state === "bye");
  return { matches: out, byId, champion, runnerUp, complete, stale };
}

/**
 * Final and live placings. Higher key = better. Players still in get no place (0).
 * Players knocked out in the same round share a place (e.g. two 3rds without a third-place match).
 */
export function bracketPlacings(plan: BracketPlan, r: ResolvedBracket, ids: string[], withdrawn: Set<string>): Map<string, { place: number; out: boolean }> {
  const key = new Map<string, number>();
  const eliminated = new Set<string>();
  for (const m of r.matches) {
    if (m.state !== "done" || !m.loser) continue;
    if (m.loserTo) continue; // dropping to the losers bracket or the third-place match isn't elimination…
    if (m.section === "GF" && plan.bracketReset && m.b.kind === "player" && m.winner === m.b.id) continue; // …nor losing the first grand final when there's a reset
    eliminated.add(m.loser);
    const k =
      m.section === "W" ? (m.round === plan.rounds ? 999 : m.round) // the final's loser is runner-up
      : m.section === "L" ? 100 + m.round
      : m.section === "3P" ? 997
      : 999; // GF / GF2: runner-up
    key.set(m.loser, k);
  }
  const third = r.byId.get("3P");
  if (third && (third.state === "done" || third.state === "bye") && third.winner) key.set(third.winner, 998);
  if (r.champion) key.set(r.champion, 1000);

  const res = new Map<string, { place: number; out: boolean }>();
  const ranked = ids.filter((id) => key.has(id));
  for (const id of ids) {
    const k = key.get(id);
    if (k === undefined) {
      // Still in (or withdrawn before losing anything).
      res.set(id, { place: 0, out: withdrawn.has(id) });
      continue;
    }
    // Places count everyone still alive as ahead of the eliminated.
    const alive = ids.filter((x) => !key.has(x) && !withdrawn.has(x)).length;
    const better = ranked.filter((x) => key.get(x)! > k).length;
    res.set(id, { place: alive + better + 1, out: eliminated.has(id) });
  }
  return res;
}
