// derive(board) → everything a screen shows: matches, standings, up next, champion.
// Pure: the same board always gives the same result.

import { bracketPlacings, buildPlan, resolveBracket, resultFits } from "./bracket.js";
import { emptyRecord, rankIds, records, type PlayedMatch, type Tiebreaker } from "./ranking.js";
import type { Board, Column, DerivedBoard, DerivedMatch, LeagueTiebreak, MatchResult, Participant, StandingRow } from "./types.js";

const nameMap = (b: Board) => new Map(b.participants.map((p) => [p.id, p.name]));
const withdrawnSet = (b: Board) => new Set(b.participants.filter((p) => p.withdrawn).map((p) => p.id));

/** Seeds for a bracket: the stored order, then anyone missing from it, never a removed id. */
export function seedList(b: Board): string[] {
  const ids = new Set(b.participants.map((p) => p.id));
  const seeds = b.seeds.filter((id) => ids.has(id));
  for (const p of b.participants) if (!seeds.includes(p.id)) seeds.push(p.id);
  return seeds;
}

/** Ready matches, the ones called to a lane first (in call order), then in bracket order. */
function upNextOf(matches: DerivedMatch[]): DerivedMatch[] {
  const ready = matches.filter((m) => m.state === "ready");
  const order = new Map(ready.map((m, i) => [m.id, i]));
  return ready.sort((x, y) => {
    if (x.calledAt && y.calledAt) return x.calledAt - y.calledAt;
    if (x.calledAt) return -1;
    if (y.calledAt) return 1;
    return order.get(x.id)! - order.get(y.id)!;
  });
}

export function derive(b: Board): DerivedBoard {
  return withGames(b, deriveFormat(b));
}

function deriveFormat(b: Board): DerivedBoard {
  switch (b.format) {
    case "single":
    case "double":
      return deriveBracket(b);
    case "roundrobin":
      return deriveRoundRobin(b);
    case "ladder":
      return deriveLadder(b);
    case "best":
      return deriveBest(b);
    default:
      return b.settings.points.scoring === "matches" ? deriveLeague(b) : derivePoints(b);
  }
}

/** The game a match is being played in, while it's still the same two players and undecided. */
export function liveGameLink(b: Board, m: DerivedMatch) {
  const g = b.meta[m.id]?.game;
  if (!g || m.state !== "ready" || m.a.kind !== "player" || m.b.kind !== "player") return undefined;
  return (g.a === m.a.id && g.b === m.b.id) || (g.a === m.b.id && g.b === m.a.id) ? g : undefined;
}

/** Games on the box and the host's notes, onto the matches they belong to. Objects are shared
 * between `matches` and `upNext`, so setting them once covers both. */
function withGames(b: Board, d: DerivedBoard): DerivedBoard {
  if (!Object.keys(b.meta).length) return d;
  for (const m of d.matches) {
    const meta = b.meta[m.id];
    if (!meta) continue;
    const g = liveGameLink(b, m);
    if (g) m.game = { name: g.game, room: g.room, ...(g.joinUrl ? { joinUrl: g.joinUrl } : {}) };
    if (meta.note && m.state !== "done") m.note = meta.note;
  }
  return d;
}

// ----------------------------------------------------------------- brackets

export function bracketPlanFor(b: Board) {
  const s = b.format === "double" ? b.settings.double : b.settings.single;
  return buildPlan(b.format === "double" ? "double" : "single", Math.max(2, b.participants.length), {
    thirdPlace: s.thirdPlace,
    bracketReset: s.bracketReset,
  });
}

function deriveBracket(b: Board): DerivedBoard {
  const seeds = seedList(b);
  const withdrawn = withdrawnSet(b);
  const names = nameMap(b);
  const plan = bracketPlanFor(b);
  const r = resolveBracket(plan, seeds, b.results, withdrawn, b.meta);
  const placings = bracketPlacings(plan, r, seeds, withdrawn);
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const m of r.matches) {
    if (m.state !== "done") continue;
    wins.set(m.winner!, (wins.get(m.winner!) ?? 0) + 1);
    losses.set(m.loser!, (losses.get(m.loser!) ?? 0) + 1);
  }
  const standings: StandingRow[] = seeds.map((id, i) => {
    const pl = placings.get(id)!;
    return {
      id,
      name: names.get(id) ?? "?",
      place: pl.place,
      value: null,
      out: pl.out || withdrawn.has(id),
      cells: { seed: i + 1, w: wins.get(id) ?? 0, l: losses.get(id) ?? 0 },
    };
  });
  standings.sort((x, y) => (x.place || 0.5) - (y.place || 0.5) || (x.cells.seed as number) - (y.cells.seed as number));
  return {
    matches: r.matches,
    standings,
    columns: [
      { key: "seed", label: "Seed", type: "num" },
      { key: "w", label: "W", type: "num" },
      { key: "l", label: "L", type: "num" },
    ],
    upNext: upNextOf(r.matches),
    complete: b.participants.length >= 2 && r.complete,
    champion: r.champion,
  };
}

/** Bracket results that are stored but no longer apply (for re-flow warnings and cleanup). */
export function staleResults(b: Board): string[] {
  if (b.format !== "single" && b.format !== "double") return [];
  return resolveBracket(bracketPlanFor(b), seedList(b), b.results, withdrawnSet(b)).stale;
}

// ----------------------------------------------------------------- points table (rounds)

function derivePoints(b: Board): DerivedBoard {
  const s = b.settings.points;
  const names = nameMap(b);
  const sign = s.order === "low" ? -1 : 1;
  const active = b.participants;
  const totals = new Map<string, number>();
  const anyScore = new Set<string>();
  for (const p of active) {
    const row = b.scores[p.id] ?? {};
    let t = 0;
    for (const r of s.rounds) {
      const v = row[r.id];
      if (typeof v === "number") {
        t += v;
        anyScore.add(p.id);
      }
    }
    totals.set(p.id, t);
  }
  const roundVal = (id: string, rid: string) => b.scores[id]?.[rid];
  const tb: Record<string, Tiebreaker> = {
    bestRound: (g) =>
      new Map(g.map((id) => [id, Math.max(...s.rounds.map((r) => sign * (roundVal(id, r.id) ?? (sign > 0 ? 0 : -Infinity))), -Infinity)])),
    lastRound: (g) => {
      // The latest round anyone has a score in.
      const last = [...s.rounds].reverse().find((r) => active.some((p) => typeof roundVal(p.id, r.id) === "number"));
      return new Map(g.map((id) => [id, last ? sign * (roundVal(id, last.id) ?? 0) : 0]));
    },
    mostRoundWins: (g) => {
      const winsBy = new Map(g.map((id) => [id, 0]));
      for (const r of s.rounds) {
        const vals = active.map((p) => roundVal(p.id, r.id)).filter((v): v is number => typeof v === "number");
        if (!vals.length) continue;
        const best = sign > 0 ? Math.max(...vals) : Math.min(...vals);
        for (const id of g) if (roundVal(id, r.id) === best) winsBy.set(id, winsBy.get(id)! + 1);
      }
      return winsBy;
    },
  };
  const ids = active.filter((p) => !p.withdrawn).map((p) => p.id);
  const primary = new Map(ids.map((id) => [id, sign * totals.get(id)!]));
  const places = rankIds(ids, primary, s.tiebreaks.map((t) => tb[t]).filter(Boolean));
  const anyAtAll = anyScore.size > 0;
  const standings: StandingRow[] = active.map((p) => {
    const cells: StandingRow["cells"] = {};
    for (const r of s.rounds) cells[r.id] = roundVal(p.id, r.id) ?? null;
    return {
      id: p.id,
      name: names.get(p.id)!,
      place: anyAtAll && !p.withdrawn ? places.get(p.id) ?? 0 : 0,
      value: totals.get(p.id)!,
      cells,
      out: p.withdrawn,
    };
  });
  sortStandings(standings);
  const columns: Column[] = s.rounds.map((r) => ({ key: r.id, label: r.name, type: "num" }));
  return { matches: [], standings, columns, upNext: [], complete: true, champion: leaderOf(standings) };
}

function sortStandings(rows: StandingRow[]) {
  rows.sort((x, y) => (x.out ? 1 : 0) - (y.out ? 1 : 0) || (x.place || 1e9) - (y.place || 1e9) || x.name.localeCompare(y.name));
}

/** The sole leader, if exactly one participant is in first place. */
function leaderOf(rows: StandingRow[]): string | undefined {
  const first = rows.filter((r) => r.place === 1);
  return first.length === 1 ? first[0].id : undefined;
}

// ----------------------------------------------------------------- league tables

function leagueTiebreakers(order: LeagueTiebreak[], played: PlayedMatch[], pts: { win: number; draw: number; loss: number }): Tiebreaker[] {
  // Head-to-head counts only the matches among the tied participants; the others use every match.
  const global = records([...new Set(played.flatMap((m) => [m.a, m.b]))], played, pts);
  return order.map((t) => (g: string[]) => {
    if (t === "headToHead") return new Map([...records(g, played, pts)].map(([id, r]) => [id, r.pts]));
    return new Map(
      g.map((id) => {
        const r = global.get(id) ?? emptyRecord();
        return [id, t === "wins" ? r.w : t === "diff" ? r.f - r.a : r.f];
      }),
    );
  });
}

const LEAGUE_COLUMNS: Column[] = [
  { key: "p", label: "P", type: "num" },
  { key: "w", label: "W", type: "num" },
  { key: "d", label: "D", type: "num" },
  { key: "l", label: "L", type: "num" },
  { key: "diff", label: "+/−", type: "num" },
];

function leagueTable(
  participants: Participant[],
  played: PlayedMatch[],
  pts: { win: number; draw: number; loss: number },
  tiebreaks: LeagueTiebreak[],
  group?: number,
): StandingRow[] {
  const ids = participants.map((p) => p.id);
  const recs = records(ids, played, pts);
  const inIds = participants.filter((p) => !p.withdrawn).map((p) => p.id);
  const primary = new Map(inIds.map((id) => [id, recs.get(id)!.pts]));
  const places = rankIds(inIds, primary, leagueTiebreakers(tiebreaks, played, pts));
  const anyPlayed = played.length > 0;
  const rows: StandingRow[] = participants.map((p) => {
    const r = recs.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      place: anyPlayed && !p.withdrawn ? places.get(p.id) ?? 0 : 0,
      value: r.pts,
      cells: { p: r.p, w: r.w, d: r.d, l: r.l, diff: r.f - r.a },
      out: p.withdrawn,
      group,
    };
  });
  sortStandings(rows);
  return rows;
}

const playedOf = (r: MatchResult): PlayedMatch => ({ a: r.a, b: r.b, winner: r.winner, scoreA: r.scoreA, scoreB: r.scoreB });

/** A result fits a league/round robin match: the same two players; a draw (null) if allowed. */
export function leagueResultFits(r: MatchResult | undefined, a: string, b: string): r is MatchResult {
  if (!r) return false;
  const same = (r.a === a && r.b === b) || (r.a === b && r.b === a);
  return same && (r.winner === null || r.winner === a || r.winner === b);
}

function deriveLeague(b: Board): DerivedBoard {
  const s = b.settings.points;
  const withdrawn = withdrawnSet(b);
  const matches: DerivedMatch[] = b.leagueMatches.map((m, i) => leagueMatchView(b, m.id, m.a, m.b, m.result, i, withdrawn, "Match"));
  const played = matches.filter((m) => m.state === "done").map((m) => playedOf(m.result!));
  const standings = leagueTable(b.participants, played, s, s.leagueTiebreaks);
  return { matches, standings, columns: LEAGUE_COLUMNS, upNext: upNextOf(matches), complete: true, champion: leaderOf(standings) };
}

function leagueMatchView(
  b: Board,
  id: string,
  a: string,
  bb: string,
  result: MatchResult | undefined,
  index: number,
  withdrawn: Set<string>,
  label: string,
  round = 1,
  group?: number,
): DerivedMatch {
  const done = leagueResultFits(result, a, bb);
  const meta = b.meta[id];
  const skipped = !done && (withdrawn.has(a) || withdrawn.has(bb));
  return {
    id,
    section: group === undefined ? "LG" : "RR",
    round,
    index,
    group,
    label,
    a: { kind: "player", id: a },
    b: { kind: "player", id: bb },
    state: done ? "done" : skipped ? "skipped" : "ready",
    result: done ? result : undefined,
    winner: done && result.winner ? result.winner : undefined,
    loser: done && result.winner ? (result.winner === a ? bb : a) : undefined,
    lane: meta?.lane,
    calledAt: meta?.calledAt,
  };
}

// ----------------------------------------------------------------- round robin

/** Snake seeding into groups: 1,2,3,4 / 8,7,6,5 / 9,10… so groups are even. */
export function makeGroups(seeds: string[], groups: number): string[][] {
  const g = Math.max(1, Math.min(groups, Math.floor(seeds.length / 2) || 1));
  const out: string[][] = Array.from({ length: g }, () => []);
  seeds.forEach((id, i) => {
    const row = Math.floor(i / g);
    const col = i % g;
    out[row % 2 === 0 ? col : g - 1 - col].push(id);
  });
  return out;
}

/** The circle method: n players (a bye added when odd), n-1 rounds, each pair once. */
export function circleSchedule(ids: string[]): [string, string][][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = list[i];
      const y = list[n - 1 - i];
      if (x !== null && y !== null) pairs.push(r % 2 === 0 || i > 0 ? [x, y] : [y, x]);
    }
    rounds.push(pairs);
    // Keep the first fixed, rotate the rest.
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

export const groupName = (g: number): string => String.fromCharCode(65 + (g % 26));

export function roundRobinGroups(b: Board): string[][] {
  if (b.groups?.length) {
    const ids = new Set(b.participants.map((p) => p.id));
    return b.groups.map((g) => g.filter((id) => ids.has(id)));
  }
  return makeGroups(seedList(b), b.settings.roundrobin.groups);
}

function deriveRoundRobin(b: Board): DerivedBoard {
  const s = b.settings.roundrobin;
  const withdrawn = withdrawnSet(b);
  const groups = roundRobinGroups(b);
  const multi = groups.length > 1;
  const matches: DerivedMatch[] = [];
  groups.forEach((g, gi) => {
    const sched = circleSchedule(g);
    for (let leg = 0; leg < Math.max(1, s.legs); leg++) {
      sched.forEach((pairs, ri) => {
        const round = leg * sched.length + ri + 1;
        pairs.forEach(([x, y], i) => {
          const [a, bb] = leg % 2 ? [y, x] : [x, y];
          const id = `RR${gi}.${round}.${i}`;
          const label = `${multi ? `Group ${groupName(gi)} · ` : ""}Round ${round}`;
          matches.push(leagueMatchView(b, id, a, bb, b.results[id], i, withdrawn, label, round, gi));
        });
      });
    }
  });
  const byId = new Map(b.participants.map((p) => [p.id, p]));
  const groupStandings = groups.map((g, gi) =>
    leagueTable(
      g.map((id) => byId.get(id)!).filter(Boolean),
      matches.filter((m) => m.group === gi && m.state === "done").map((m) => playedOf(m.result!)),
      s,
      s.leagueTiebreaks,
      gi,
    ),
  );
  const standings = multi ? groupStandings.flat() : groupStandings[0] ?? [];
  const complete = b.participants.length >= 2 && matches.every((m) => m.state === "done" || m.state === "skipped");
  return {
    matches,
    standings,
    columns: LEAGUE_COLUMNS,
    upNext: upNextOf(matches),
    complete,
    champion: multi ? undefined : leaderOf(standings),
    groupStandings: multi ? groupStandings : undefined,
  };
}

/** Who goes through to a knockout: the top `n` of each group, ordered A1, B1, A2, B2… (or the
 * top n of a single table). Players tied across the cut all go through. */
export function qualifiers(d: DerivedBoard, n: number): string[] {
  const tables = d.groupStandings ?? [d.standings];
  const perGroup = tables.map((rows) => rows.filter((r) => !r.out && r.place > 0 && r.place <= n));
  const out: string[] = [];
  const longest = Math.max(0, ...perGroup.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of perGroup) if (g[i]) out.push(g[i].id);
  return out;
}

// ----------------------------------------------------------------- ladder

/** The ladder after every played challenge, in the order they were made. */
export function ladderOrder(b: Board): string[] {
  const order = seedList(b);
  const sorted = [...b.challenges].sort((x, y) => x.createdAt - y.createdAt);
  for (const c of sorted) {
    if (!c.result || !leagueResultFits(c.result, c.challenger, c.defender)) continue;
    const ci = order.indexOf(c.challenger);
    const di = order.indexOf(c.defender);
    if (ci < 0 || di < 0) continue;
    // A challenger who beats someone above them takes their place; everyone between moves down one.
    if (c.result.winner === c.challenger && ci > di) {
      order.splice(ci, 1);
      order.splice(di, 0, c.challenger);
    }
  }
  return order;
}

function deriveLadder(b: Board): DerivedBoard {
  const withdrawn = withdrawnSet(b);
  const names = nameMap(b);
  const order = ladderOrder(b);
  const matches = [...b.challenges]
    .sort((x, y) => x.createdAt - y.createdAt)
    .map((c, i) => leagueMatchView(b, c.id, c.challenger, c.defender, c.result, i, withdrawn, "Challenge"));
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const m of matches)
    if (m.state === "done" && m.winner) {
      wins.set(m.winner, (wins.get(m.winner) ?? 0) + 1);
      losses.set(m.loser!, (losses.get(m.loser!) ?? 0) + 1);
    }
  let place = 0;
  const standings: StandingRow[] = order.map((id) => {
    const out = withdrawn.has(id);
    return { id, name: names.get(id)!, place: out ? 0 : ++place, value: null, out, cells: { w: wins.get(id) ?? 0, l: losses.get(id) ?? 0 } };
  });
  sortStandings(standings);
  return {
    matches,
    standings,
    columns: [
      { key: "w", label: "W", type: "num" },
      { key: "l", label: "L", type: "num" },
    ],
    upNext: upNextOf(matches),
    complete: true,
    champion: standings.find((r) => r.place === 1)?.id,
  };
}

/** Who `challenger` may challenge now: above them, within reach, and nobody tied up in a challenge already. */
export function ladderTargets(b: Board, challenger: string): string[] {
  const order = ladderOrder(b).filter((id) => !withdrawnSet(b).has(id));
  const busy = new Set(b.challenges.filter((c) => !c.result).flatMap((c) => [c.challenger, c.defender]));
  const ci = order.indexOf(challenger);
  if (ci <= 0 || busy.has(challenger)) return [];
  const reach = b.settings.ladder.reach;
  const from = reach > 0 ? Math.max(0, ci - reach) : 0;
  return order.slice(from, ci).filter((id) => !busy.has(id));
}

// ----------------------------------------------------------------- best score / time

function deriveBest(b: Board): DerivedBoard {
  const s = b.settings.best;
  const sign = s.order === "low" ? -1 : 1;
  const by = new Map<string, number[]>();
  for (const a of b.attempts) by.set(a.pid, [...(by.get(a.pid) ?? []), a.value]);
  const sortedVals = (id: string) => [...(by.get(id) ?? [])].sort((x, y) => sign * (y - x));
  const ids = b.participants.filter((p) => !p.withdrawn && by.has(p.id)).map((p) => p.id);
  const primary = new Map(ids.map((id) => [id, sign * sortedVals(id)[0]]));
  const second: Tiebreaker = (g) => new Map(g.map((id) => [id, sortedVals(id)[1] !== undefined ? sign * sortedVals(id)[1] : -Infinity]));
  const places = rankIds(ids, primary, [second]);
  const standings: StandingRow[] = b.participants.map((p) => {
    const vals = sortedVals(p.id);
    return {
      id: p.id,
      name: p.name,
      place: places.get(p.id) ?? 0,
      value: vals.length ? vals[0] : null,
      cells: { tries: vals.length, next: vals[1] ?? null },
      out: p.withdrawn,
    };
  });
  sortStandings(standings);
  return {
    matches: [],
    standings,
    columns: [
      { key: "tries", label: "Tries", type: "num" },
      { key: "next", label: "2nd best", type: s.unit === "time" ? "time" : "num" },
    ],
    upNext: [],
    complete: true,
    champion: leaderOf(standings),
  };
}

// ----------------------------------------------------------------- helpers for screens

/** Everyone in first place (a shared win lists them all). */
export function leaders(d: DerivedBoard): string[] {
  return d.standings.filter((r) => r.place === 1 && !r.out).map((r) => r.id);
}

/** Final placings to report when a board finishes: [{ id, place }] for everyone placed. */
export function finalPlaces(d: DerivedBoard): { id: string; place: number; value: number | null }[] {
  return d.standings.filter((r) => r.place > 0).map((r) => ({ id: r.id, place: r.place, value: r.value }));
}

export { resultFits };
