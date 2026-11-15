// Every change a scorekeeper can make to a board, as one pure function:
// applyAction(board, action) → the new board, or a friendly refusal.
//
// The server runs it under the board's lock and version check, saves, and broadcasts.
// Changing a bracket result that later results were built on refuses with code "REFLOW"
// (listing what would be cleared) unless the action says force: true.

import { MAX_DOUBLE, MAX_SINGLE } from "./bracket.js";
import { defaultSettings, LIMITS, PRESETS } from "./defaults.js";
import { derive, ladderTargets, leagueResultFits, makeGroups, seedList, staleResults } from "./derive.js";
import type {
  BestSettings,
  Board,
  BracketSettings,
  FormatId,
  GameLink,
  FormatSettings,
  LadderSettings,
  LeagueTiebreak,
  MatchResult,
  Participant,
  PointsSettings,
  PointsTiebreak,
  RoundRobinSettings,
  SeasonLink,
  SeasonNight,
  Theme,
  TitleStyle,
} from "./types.js";

export type Action =
  | { type: "rename"; title?: string; subtitle?: string; kind?: "nightly" | "season" }
  | { type: "format"; format: FormatId }
  | { type: "settings"; settings: unknown }
  | { type: "addParticipants"; names: string[] }
  | { type: "editParticipant"; id: string; name?: string; members?: string[] }
  | { type: "removeParticipant"; id: string }
  | { type: "restoreParticipant"; id: string }
  | { type: "entry"; kind: "players" | "teams"; size?: number }
  | { type: "arrange"; teams: { id?: string; name: string; members: string[] }[]; waiting: string[] }
  | { type: "seeds"; ids: string[] }
  | { type: "shuffle" }
  | { type: "start" }
  | { type: "finish" }
  | { type: "reopen" }
  | { type: "result"; matchId: string; winner: string | null; scoreA?: number | null; scoreB?: number | null; forfeit?: boolean; force?: boolean }
  | { type: "clearResult"; matchId: string; force?: boolean }
  | { type: "score"; pid: string; roundId: string; value: number | null }
  | { type: "attempt"; pid: string; value: number }
  | { type: "removeAttempt"; id: string }
  | { type: "leagueMatch"; a: string; b: string }
  | { type: "removeLeagueMatch"; id: string }
  | { type: "challenge"; challenger: string; defender: string }
  | { type: "removeChallenge"; id: string }
  | { type: "lanes"; lanes: string[] }
  | { type: "lane"; matchId: string; lane: string | null }
  | { type: "call"; matchId: string; called: boolean }
  | { type: "theme"; theme: unknown }
  | { type: "season"; season: unknown }
  /** Server only: a match started in (or finished with) a game on the box. */
  | { type: "gameLink"; matchId: string; game: GameLink | null; note?: string };

export type ActionType = Action["type"];

/** Actions only the server makes (the box's match results); a phone can't send them. */
export const SERVER_ACTIONS: readonly ActionType[] = ["gameLink"];

export type ActionResult =
  | { ok: true; board: Board; /** The match a result was recorded for (for events and "just changed" highlights). */ matchId?: string }
  | { ok: false; error: string; code?: "REFLOW" | "INVALID" | "NOT_FOUND" | "STATE"; affected?: string[] };

export interface ActionEnv {
  now: number;
  newId: () => string;
  /** 0 ≤ x < 1, for shuffles. */
  random: () => number;
}

const fail = (error: string, code: "INVALID" | "NOT_FOUND" | "STATE" = "INVALID"): ActionResult => ({ ok: false, error, code });

const BRACKETS: FormatId[] = ["single", "double"];
const isBracket = (b: Board) => BRACKETS.includes(b.format);
/** Formats whose entrant list is fixed once the board starts. */
const lockedEntries = (b: Board) => isBracket(b) || b.format === "roundrobin";

// ----------------------------------------------------------------- input cleaning

export function cleanName(v: unknown, max: number = LIMITS.name): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const pickList = <T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => allowed.includes(x as T)))] : fallback;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const COLOR = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, fallback: string) => (typeof v === "string" && COLOR.test(v) ? v.toLowerCase() : fallback);

/** A score: a finite number, two decimals at most (times in seconds, darts, trivia half points). */
export function cleanScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > LIMITS.score) return null;
  return Math.round(n * 100) / 100;
}

/** Merges a settings patch into the current settings, keeping every value in range. */
export function mergeSettings(cur: FormatSettings, patch: unknown): FormatSettings {
  const p = obj(patch);
  const d = defaultSettings();
  const pts = { ...cur.points, ...obj(p.points) } as Record<string, unknown>;
  const roundsIn = Array.isArray(pts.rounds) ? pts.rounds : cur.points.rounds;
  const seen = new Set<string>();
  const rounds = (roundsIn as unknown[])
    .map((r, i) => {
      const o = obj(r);
      let id = typeof o.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(o.id) ? o.id : `r${i + 1}`;
      while (seen.has(id)) id = `${id}x`;
      seen.add(id);
      return { id, name: cleanName(o.name, 16) || `R${i + 1}` };
    })
    .slice(0, LIMITS.rounds);
  const points: PointsSettings = {
    scoring: pick(pts.scoring, ["rounds", "matches"] as const, cur.points.scoring),
    rounds: rounds.length ? rounds : d.points.rounds.slice(0, 1),
    order: pick(pts.order, ["high", "low"] as const, cur.points.order),
    tiebreaks: pickList<PointsTiebreak>(pts.tiebreaks, ["bestRound", "lastRound", "mostRoundWins"], cur.points.tiebreaks),
    win: num(pts.win, -100, 100, cur.points.win),
    draw: num(pts.draw, -100, 100, cur.points.draw),
    loss: num(pts.loss, -100, 100, cur.points.loss),
    leagueTiebreaks: pickList<LeagueTiebreak>(pts.leagueTiebreaks, ["headToHead", "wins", "diff", "scored"], cur.points.leagueTiebreaks),
  };
  const bracket = (c: BracketSettings, v: unknown): BracketSettings => {
    const o = { ...c, ...obj(v) } as Record<string, unknown>;
    return {
      seeding: pick(o.seeding, ["manual", "random", "board"] as const, c.seeding),
      thirdPlace: bool(o.thirdPlace, c.thirdPlace),
      bracketReset: bool(o.bracketReset, c.bracketReset),
      bestOf: oddBestOf(o.bestOf, c.bestOf),
    };
  };
  const rr = { ...cur.roundrobin, ...obj(p.roundrobin) } as Record<string, unknown>;
  const roundrobin: RoundRobinSettings = {
    groups: int(rr.groups, 1, 16, cur.roundrobin.groups),
    legs: int(rr.legs, 1, 2, cur.roundrobin.legs),
    win: num(rr.win, -100, 100, cur.roundrobin.win),
    draw: num(rr.draw, -100, 100, cur.roundrobin.draw),
    loss: num(rr.loss, -100, 100, cur.roundrobin.loss),
    allowDraws: bool(rr.allowDraws, cur.roundrobin.allowDraws),
    bestOf: oddBestOf(rr.bestOf, cur.roundrobin.bestOf),
    leagueTiebreaks: pickList<LeagueTiebreak>(rr.leagueTiebreaks, ["headToHead", "wins", "diff", "scored"], cur.roundrobin.leagueTiebreaks),
    advance: int(rr.advance, 0, 16, cur.roundrobin.advance),
  };
  const ld = { ...cur.ladder, ...obj(p.ladder) } as Record<string, unknown>;
  const ladder: LadderSettings = { reach: int(ld.reach, 0, 50, cur.ladder.reach), bestOf: oddBestOf(ld.bestOf, cur.ladder.bestOf) };
  const bs = { ...cur.best, ...obj(p.best) } as Record<string, unknown>;
  const best: BestSettings = {
    order: pick(bs.order, ["high", "low"] as const, cur.best.order),
    unit: pick(bs.unit, ["points", "time", "number"] as const, cur.best.unit),
    maxAttempts: int(bs.maxAttempts, 0, 100, cur.best.maxAttempts),
    label: cleanName(bs.label, 20) || cur.best.label,
  };
  return { points, single: bracket(cur.single, p.single), double: bracket(cur.double, p.double), roundrobin, ladder, best };
}

function oddBestOf(v: unknown, fallback: number): number {
  const n = int(v, 1, 15, fallback);
  return n % 2 ? n : n + 1;
}

const TITLE_STYLES: TitleStyle[] = ["bold", "neon", "chalk", "classic", "marquee"];

export function mergeTheme(cur: Theme, patch: unknown): Theme {
  const p = obj(patch);
  // Picking a preset starts from it; the rest of the patch goes on top.
  const base: Theme =
    typeof p.preset === "string" && p.preset !== cur.preset && PRESETS.some((x) => x.id === p.preset)
      ? { preset: p.preset, ...structuredClone(PRESETS.find((x) => x.id === p.preset)!.theme), logo: cur.logo }
      : cur;
  const bg = { ...base.background, ...obj(p.background) } as Record<string, unknown>;
  const image = (v: unknown, fallback: string | undefined) =>
    v === null || v === "" ? undefined : typeof v === "string" && /^[a-z0-9]{8,40}\.(png|jpg|webp|gif)$/.test(v) ? v : fallback;
  const emoji = typeof p.emoji === "string" ? [...p.emoji.trim()].slice(0, 4).join("") : base.emoji;
  return {
    preset: typeof p.preset === "string" && p.preset === "custom" ? "custom" : base.preset,
    accent: color(p.accent, base.accent),
    accent2: color(p.accent2, base.accent2),
    text: color(p.text, base.text),
    background: {
      kind: pick(bg.kind, ["solid", "gradient", "image"] as const, base.background.kind),
      color: color(bg.color, base.background.color),
      color2: color(bg.color2, base.background.color2),
      image: image(bg.image, base.background.image),
    },
    titleStyle: pick(p.titleStyle, TITLE_STYLES, base.titleStyle),
    emoji,
    logo: "logo" in p ? image(p.logo, base.logo) : base.logo,
    useVenue: bool(p.useVenue, base.useVenue),
  };
}

export function cleanSeason(v: unknown, selfId: string): SeasonLink | undefined {
  if (v === null) return undefined;
  const o = obj(v);
  const boards = Array.isArray(o.boards)
    ? [...new Set(o.boards.filter((x): x is string => typeof x === "string" && x !== selfId && x.length <= 40))].slice(0, LIMITS.seasonBoards)
    : [];
  const placePoints = Array.isArray(o.placePoints)
    ? o.placePoints.map((x) => num(x, -1000, 1000, 0)).slice(0, 32)
    : [10, 8, 6, 5, 4, 3, 2, 1];
  const nights: SeasonNight[] = (Array.isArray(o.nights) ? o.nights : []).slice(0, LIMITS.seasonBoards).flatMap((n) => {
    const x = obj(n);
    const results = (Array.isArray(x.results) ? x.results : [])
      .map((r) => {
        const y = obj(r);
        const score = y.score === undefined || y.score === null || y.score === "" ? undefined : Number(y.score);
        return { name: cleanName(y.name), place: int(y.place, 1, 999, 0), ...(score !== undefined && Number.isFinite(score) ? { score } : {}) };
      })
      .filter((r) => r.name && r.place > 0)
      .slice(0, LIMITS.participants);
    const id = typeof x.id === "string" && /^[a-z0-9]{4,20}$/.test(x.id) ? x.id : "";
    if (!id || !results.length) return [];
    return [{ id, title: cleanName(x.title, 40) || "Night", at: int(x.at, 0, 8.64e15, 0), results }];
  });
  const aliases: Record<string, string> = {};
  for (const [from, to] of Object.entries(obj(o.aliases)).slice(0, 500)) {
    const k = nameKey(String(from));
    const name = cleanName(to);
    if (k && name && k !== nameKey(name)) aliases[k] = name;
  }
  return {
    boards,
    scoring: pick(o.scoring, ["placement", "total"] as const, "placement"),
    placePoints,
    ...(nights.length ? { nights } : {}),
    ...(Object.keys(aliases).length ? { aliases } : {}),
  };
}

/** How names are matched across nights: case and spacing don't matter. */
export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface ReadEntrant {
  name: string;
  members?: string[];
  /** 1-based line the entrant starts on. */
  line: number;
}

/**
 * Pasted text or a CSV → entrants, with what was skipped (for the "we read it as" preview).
 * One per line. "Team: a, b" or a spreadsheet row "Team,a,b" gives a team with members, and
 * so do the lines under "Team:" (a line ending with a colon) and lines starting with "-" or
 * "•" under a team's line. A first row that's a header ("Name", "Team", "Player") is skipped.
 */
export function readEntrants(text: string): { entrants: ReadEntrant[]; header: boolean } {
  const out: ReadEntrant[] = [];
  let header = false;
  let first = true;
  // After "Team:" the following indented lines are its members.
  let open = false;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      open = false;
      return;
    }
    const bullet = /^\s*[-•*]\s*\S/.test(raw);
    const member = out.length > 0 && (bullet || (open && /^\s/.test(raw)));
    if (member) {
      const m = cleanName(line.replace(/^[-•*]\s*/, ""));
      const team = out[out.length - 1];
      if (m && (team.members?.length ?? 0) < LIMITS.members) team.members = [...(team.members ?? []), m];
      return;
    }
    let e: ReadEntrant;
    const colon = line.indexOf(":");
    open = colon > 0 && colon === line.length - 1;
    if (colon > 0) {
      const members = line.slice(colon + 1).split(/[,;]/).map((m) => cleanName(m)).filter(Boolean).slice(0, LIMITS.members);
      e = { name: cleanName(line.slice(0, colon)), line: i + 1 };
      if (members.length) e.members = members;
    } else {
      // CSV-ish: "name,member,member" from a spreadsheet.
      const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => cleanName(c.replace(/^"|"$/g, "").replace(/""/g, '"')));
      const members = cells.slice(1).filter(Boolean).slice(0, LIMITS.members);
      e = { name: cells[0], line: i + 1 };
      if (members.length) e.members = members;
    }
    if (first && /^(name|names|team|teams|team name|player|players)$/i.test(e.name)) {
      header = true;
      first = false;
      return;
    }
    first = false;
    if (e.name) out.push(e);
  });
  return { entrants: out, header };
}

/** Pasted text or a CSV → entrants (see readEntrants). */
export function parseEntrants(text: string): { name: string; members?: string[] }[] {
  return readEntrants(text).entrants.map(({ name, members }) => (members ? { name, members } : { name }));
}

/** An entrant as a line parseEntrants reads back ("Team: a, b"). */
export const entrantLine = (e: { name: string; members?: string[] }): string =>
  e.members?.length ? `${e.name.replace(/:/g, " ")}: ${e.members.join(", ")}` : e.name.replace(/:/g, " ");

// ----------------------------------------------------------------- the reducer

export function applyAction(board: Board, action: Action, env: ActionEnv): ActionResult {
  const b: Board = structuredClone(board);
  const r = reduce(b, action, env);
  if (!r.ok) return r;
  b.version = board.version + 1;
  b.updatedAt = env.now;
  return { ok: true, board: b, matchId: r.matchId };
}

type Inner = { ok: true; matchId?: string } | Exclude<ActionResult, { ok: true }>;
const OK: Inner = { ok: true };

function participant(b: Board, id: unknown): Participant | undefined {
  return typeof id === "string" ? b.participants.find((p) => p.id === id) : undefined;
}

function reduce(b: Board, a: Action, env: ActionEnv): Inner {
  if (!a || typeof a !== "object" || typeof a.type !== "string") return fail("That isn't something this board can do.");
  const draft = b.status === "draft";
  const finished = b.status === "finished";
  const scoring = new Set<ActionType>(["result", "clearResult", "score", "attempt", "removeAttempt", "leagueMatch", "removeLeagueMatch", "challenge", "removeChallenge", "call"]);
  if (finished && scoring.has(a.type)) return fail("This board is finished. Reopen it to change results.", "STATE");
  if (draft && scoring.has(a.type) && a.type !== "score" && a.type !== "attempt") return fail("Start the board first.", "STATE");

  switch (a.type) {
    case "rename": {
      if (a.title !== undefined) {
        const t = cleanName(a.title, LIMITS.title);
        if (!t) return fail("Give the board a name.");
        b.title = t;
      }
      if (a.subtitle !== undefined) b.subtitle = cleanName(a.subtitle, LIMITS.subtitle);
      if (a.kind !== undefined) b.kind = a.kind === "season" ? "season" : "nightly";
      return OK;
    }
    case "format": {
      if (!draft) return fail("The format can only change before the board starts.", "STATE");
      if (!["points", "single", "double", "roundrobin", "ladder", "best"].includes(a.format)) return fail("Unknown format.");
      b.format = a.format;
      b.results = {};
      b.groups = undefined;
      return OK;
    }
    case "settings": {
      const next = mergeSettings(b.settings, a.settings);
      if (!draft) {
        // Things that would rebuild a running bracket or schedule are fixed once started.
        const rrLocked = b.format === "roundrobin" && (next.roundrobin.groups !== b.settings.roundrobin.groups || next.roundrobin.legs !== b.settings.roundrobin.legs);
        if (rrLocked) return fail("Groups and legs are fixed once the board starts.", "STATE");
        if (b.format === "points" && next.points.scoring !== b.settings.points.scoring && (b.leagueMatches.length || Object.keys(b.scores).length))
          return fail("Scoring can't switch once results are in.", "STATE");
      }
      b.settings = next;
      // Removing a third-place match or the reset may orphan their results.
      for (const id of staleResults(b)) delete b.results[id];
      return OK;
    }
    case "addParticipants": {
      if (!draft && lockedEntries(b)) return fail("Entries are closed once a bracket or schedule starts.", "STATE");
      const names = Array.isArray(a.names) ? a.names : [];
      const entries = names.flatMap((n) => (typeof n === "string" ? parseEntrants(n) : []));
      if (!entries.length) return fail("Type at least one name.");
      const max = b.format === "double" ? MAX_DOUBLE : b.format === "single" ? MAX_SINGLE : LIMITS.participants;
      if (b.participants.length + entries.length > max) return fail(`Up to ${max} entrants on this board.`);
      const taken = new Set(b.participants.map((p) => p.name.toLowerCase()));
      for (const e of entries) {
        let name = e.name;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${e.name} (${n})`;
        taken.add(name.toLowerCase());
        const p: Participant = { id: env.newId(), name };
        if (e.members) p.members = e.members;
        b.participants.push(p);
        b.seeds.push(p.id);
      }
      // Players who were waiting for a team and just came in on one stop waiting.
      const joined = new Set(entries.flatMap((e) => e.members ?? []).map((m) => m.toLowerCase()));
      if (joined.size) b.waiting = b.waiting.filter((w) => !joined.has(w.toLowerCase()));
      return OK;
    }
    case "editParticipant": {
      const p = participant(b, a.id);
      if (!p) return fail("That entrant isn't on this board.", "NOT_FOUND");
      if (a.name !== undefined) {
        const name = cleanName(a.name);
        if (!name) return fail("A name can't be empty.");
        if (b.participants.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) return fail("Someone on this board already has that name.");
        p.name = name;
      }
      if (a.members !== undefined) {
        const m = (Array.isArray(a.members) ? a.members : []).map((x) => cleanName(x)).filter(Boolean).slice(0, LIMITS.members);
        if (m.length) p.members = m;
        else delete p.members;
      }
      return OK;
    }
    case "removeParticipant": {
      const p = participant(b, a.id);
      if (!p) return fail("That entrant isn't on this board.", "NOT_FOUND");
      if (draft) {
        b.participants = b.participants.filter((x) => x !== p);
        b.seeds = b.seeds.filter((id) => id !== p.id);
        delete b.scores[p.id];
        b.attempts = b.attempts.filter((x) => x.pid !== p.id);
        return OK;
      }
      // Once started: withdrawn. Their next bracket matches become walkovers; history stays.
      p.withdrawn = true;
      b.challenges = b.challenges.filter((c) => c.result || (c.challenger !== p.id && c.defender !== p.id));
      b.leagueMatches = b.leagueMatches.filter((m) => m.result || (m.a !== p.id && m.b !== p.id));
      return OK;
    }
    case "restoreParticipant": {
      const p = participant(b, a.id);
      if (!p) return fail("That entrant isn't on this board.", "NOT_FOUND");
      delete p.withdrawn;
      // A walkover they gave may have been played on since; those results stay only if they still fit.
      for (const id of staleResults(b)) delete b.results[id];
      return OK;
    }
    case "entry": {
      b.entry = { kind: a.kind === "teams" ? "teams" : "players", size: a.kind === "teams" ? int(a.size, 0, LIMITS.members, 0) : 0 };
      return OK;
    }
    case "arrange":
      return arrange(b, a, env);
    case "seeds": {
      if (!draft) return fail("Seeding is fixed once the board starts.", "STATE");
      const ids = Array.isArray(a.ids) ? a.ids.filter((id) => participant(b, id)) : [];
      if (new Set(ids).size !== ids.length || ids.length !== b.participants.length) return fail("Seeding must list everyone once.");
      b.seeds = ids;
      return OK;
    }
    case "shuffle": {
      if (!draft) return fail("Seeding is fixed once the board starts.", "STATE");
      const ids = seedList(b);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(env.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      b.seeds = ids;
      if (isBracket(b)) b.settings[b.format as "single" | "double"].seeding = "random";
      return OK;
    }
    case "start": {
      if (!draft) return fail("This board has already started.", "STATE");
      const n = b.participants.length;
      const min = isBracket(b) || b.format === "roundrobin" || b.format === "ladder" ? 2 : 0;
      if (n < min) return fail(`Add at least ${min} entrants first.`);
      b.seeds = seedList(b);
      if (b.format === "roundrobin") b.groups = makeGroups(b.seeds, b.settings.roundrobin.groups);
      b.status = "live";
      b.startedAt = env.now;
      return OK;
    }
    case "finish": {
      if (finished) return fail("This board is already finished.", "STATE");
      const d = derive(b);
      const names = new Map(b.participants.map((p) => [p.id, p.name]));
      const champ = d.champion ? [d.champion] : d.standings.filter((r) => r.place === 1).map((r) => r.id);
      b.winners = champ.map((id) => names.get(id)!).filter(Boolean);
      b.status = "finished";
      b.finishedAt = env.now;
      if (!b.startedAt) b.startedAt = env.now;
      // Nothing is waiting on a lane any more.
      for (const m of Object.values(b.meta)) delete m.calledAt;
      return OK;
    }
    case "reopen": {
      if (!finished) return fail("Only a finished board can be reopened.", "STATE");
      b.status = "live";
      delete b.finishedAt;
      delete b.winners;
      return OK;
    }
    case "result":
      return recordResult(b, a, env);
    case "clearResult": {
      const id = a.matchId;
      if (isBracket(b) || b.format === "roundrobin") {
        if (!b.results[id]) return fail("That match has no result.", "NOT_FOUND");
        delete b.results[id];
        return reflow(b, a.force, id);
      }
      const lm = b.leagueMatches.find((m) => m.id === id) ?? b.challenges.find((c) => c.id === id);
      if (!lm?.result) return fail("That match has no result.", "NOT_FOUND");
      delete lm.result;
      return { ok: true, matchId: id };
    }
    case "score": {
      if (b.format !== "points" || b.settings.points.scoring !== "rounds") return fail("This board doesn't take round scores.");
      if (b.season && (b.season.boards.length || b.season.nights?.length)) return fail("A season board adds up its nights; score those instead.");
      const p = participant(b, a.pid);
      if (!p) return fail("That entrant isn't on this board.", "NOT_FOUND");
      if (!b.settings.points.rounds.some((r) => r.id === a.roundId)) return fail("That round isn't on this board.", "NOT_FOUND");
      const row = (b.scores[p.id] ??= {});
      if (a.value === null) delete row[a.roundId];
      else {
        const v = cleanScore(a.value);
        if (v === null) return fail("Type a number.");
        row[a.roundId] = v;
      }
      if (!Object.keys(row).length) delete b.scores[p.id];
      return OK;
    }
    case "attempt": {
      if (b.format !== "best") return fail("This board doesn't take attempts.");
      const p = participant(b, a.pid);
      if (!p || p.withdrawn) return fail("That entrant isn't on this board.", "NOT_FOUND");
      const v = cleanScore(a.value);
      if (v === null) return fail(b.settings.best.unit === "time" ? "Type a time." : "Type a number.");
      if (b.settings.best.unit === "time" && v < 0) return fail("A time can't be negative.");
      const max = b.settings.best.maxAttempts;
      if (max && b.attempts.filter((x) => x.pid === p.id).length >= max) return fail(`${p.name} has used all ${max} attempts.`);
      if (b.attempts.length >= LIMITS.attempts) return fail("This board is full of attempts.");
      b.attempts.push({ id: env.newId(), pid: p.id, value: v, at: env.now });
      return OK;
    }
    case "removeAttempt": {
      const before = b.attempts.length;
      b.attempts = b.attempts.filter((x) => x.id !== a.id);
      return before === b.attempts.length ? fail("That attempt is already gone.", "NOT_FOUND") : OK;
    }
    case "leagueMatch": {
      if (b.format !== "points" || b.settings.points.scoring !== "matches") return fail("This board doesn't take matches.");
      const x = participant(b, a.a);
      const y = participant(b, a.b);
      if (!x || !y || x === y || x.withdrawn || y.withdrawn) return fail("Pick two different entrants.");
      if (b.leagueMatches.length >= LIMITS.leagueMatches) return fail("This board is full of matches.");
      const id = env.newId();
      b.leagueMatches.push({ id, a: x.id, b: y.id, createdAt: env.now });
      return { ok: true, matchId: id };
    }
    case "removeLeagueMatch": {
      const before = b.leagueMatches.length;
      b.leagueMatches = b.leagueMatches.filter((m) => m.id !== a.id);
      delete b.meta[a.id];
      return before === b.leagueMatches.length ? fail("That match is already gone.", "NOT_FOUND") : OK;
    }
    case "challenge": {
      if (b.format !== "ladder") return fail("Challenges are for ladders.");
      const c = participant(b, a.challenger);
      const d = participant(b, a.defender);
      if (!c || !d || c === d) return fail("Pick a challenger and who they're challenging.");
      if (!ladderTargets(b, c.id).includes(d.id)) {
        const reach = b.settings.ladder.reach;
        return fail(`${c.name} can challenge someone up to ${reach || "any number of"} place${reach === 1 ? "" : "s"} above them who isn't already in a challenge.`);
      }
      if (b.challenges.length >= LIMITS.challenges) return fail("This ladder is full of challenges.");
      const id = env.newId();
      b.challenges.push({ id, challenger: c.id, defender: d.id, createdAt: env.now });
      return { ok: true, matchId: id };
    }
    case "removeChallenge": {
      const before = b.challenges.length;
      b.challenges = b.challenges.filter((c) => c.id !== a.id);
      delete b.meta[a.id];
      return before === b.challenges.length ? fail("That challenge is already gone.", "NOT_FOUND") : OK;
    }
    case "lanes": {
      const lanes = [...new Set((Array.isArray(a.lanes) ? a.lanes : []).map((l) => cleanName(l, LIMITS.laneName)).filter(Boolean))].slice(0, LIMITS.lanes);
      b.lanes = lanes;
      for (const m of Object.values(b.meta)) if (m.lane && !lanes.includes(m.lane)) delete m.lane;
      return OK;
    }
    case "lane": {
      if (!derive(b).matches.some((m) => m.id === a.matchId)) return fail("That match isn't on this board.", "NOT_FOUND");
      if (a.lane !== null && !b.lanes.includes(a.lane)) return fail("Add that lane to the board first.");
      const m = (b.meta[a.matchId] ??= {});
      if (a.lane === null) {
        delete m.lane;
        delete m.calledAt;
      } else {
        m.lane = a.lane;
        m.calledAt ??= env.now;
      }
      tidyMeta(b, a.matchId);
      return OK;
    }
    case "call": {
      const dm = derive(b).matches.find((m) => m.id === a.matchId);
      if (!dm) return fail("That match isn't on this board.", "NOT_FOUND");
      if (a.called && dm.state !== "ready") return fail("Only a match with both sides known can be called.", "STATE");
      const m = (b.meta[a.matchId] ??= {});
      if (a.called) m.calledAt = env.now;
      else delete m.calledAt;
      tidyMeta(b, a.matchId);
      return OK;
    }
    case "theme": {
      b.theme = mergeTheme(b.theme, a.theme);
      return OK;
    }
    case "gameLink": {
      const dm = derive(b).matches.find((m) => m.id === a.matchId);
      if (!dm) return fail("That match isn't on this board.", "NOT_FOUND");
      const m = (b.meta[a.matchId] ??= {});
      if (a.game) {
        if (dm.state !== "ready" || dm.a.kind !== "player" || dm.b.kind !== "player") return fail("Only a match with both sides known and no result can be played.", "STATE");
        m.game = { ...a.game, a: dm.a.id, b: dm.b.id };
        delete m.note;
      } else {
        delete m.game;
        if (a.note) m.note = cleanName(a.note, 160);
      }
      tidyMeta(b, a.matchId);
      return { ok: true, matchId: a.matchId };
    }
    case "season": {
      if (b.format !== "points") return fail("Only a points table can sum other boards.");
      const s = cleanSeason(a.season, b.id);
      if (s) {
        b.season = s;
        b.kind = "season";
        b.settings.points.scoring = "rounds";
      } else delete b.season;
      return OK;
    }
    default:
      return fail("That isn't something this board can do.");
  }
}

/**
 * Teams and the players waiting for one, all at once (the team cards, a blind draw).
 * Existing teams keep their id (so results stay with them); a team without an id is new.
 * Before the start a team left out is removed; after it, every team must stay (withdraw
 * instead), and new teams only join formats that take late entries.
 */
function arrange(b: Board, a: Extract<Action, { type: "arrange" }>, env: ActionEnv): Inner {
  const draft = b.status === "draft";
  const teams = Array.isArray(a.teams) ? a.teams : [];
  const waitingIn = Array.isArray(a.waiting) ? a.waiting : [];
  const max = b.format === "double" ? MAX_DOUBLE : b.format === "single" ? MAX_SINGLE : LIMITS.participants;
  if (teams.length > max) return fail(`Up to ${max} entrants on this board.`);
  if (waitingIn.length > LIMITS.participants * 2) return fail("That's too many players waiting.");
  const names = new Set<string>();
  const people = new Set<string>();
  const person = (raw: unknown): string | null => {
    const n = cleanName(raw);
    if (!n) return null;
    if (people.has(n.toLowerCase())) throw new Error(`${n} is listed twice.`);
    people.add(n.toLowerCase());
    return n;
  };
  const byId = new Map(b.participants.map((p) => [p.id, p]));
  const next: Participant[] = [];
  const seen = new Set<string>();
  let waiting: string[] = [];
  try {
    for (const t of teams) {
      const o = obj(t);
      const name = cleanName(o.name);
      if (!name) return fail("Every team needs a name.");
      if (names.has(name.toLowerCase())) return fail(`There are two teams called ${name}.`);
      names.add(name.toLowerCase());
      const members = (Array.isArray(o.members) ? o.members : []).map(person).filter((m): m is string => !!m);
      if (members.length > LIMITS.members) return fail(`A team can have up to ${LIMITS.members} players.`);
      const old = typeof o.id === "string" ? byId.get(o.id) : undefined;
      if (typeof o.id === "string" && !old) return fail("A team on this list was removed meanwhile. Reload and try again.", "NOT_FOUND");
      if (old && seen.has(old.id)) return fail("A team is listed twice.");
      const p: Participant = old ? { ...old, name } : { id: env.newId(), name };
      if (members.length) p.members = members;
      else delete p.members;
      if (old) seen.add(old.id);
      next.push(p);
    }
    waiting = waitingIn.map(person).filter((m): m is string => !!m);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Someone is listed twice.");
  }
  const added = next.filter((p) => !byId.has(p.id));
  const removed = b.participants.filter((p) => !seen.has(p.id));
  if (!draft) {
    if (removed.length) return fail("Teams can't be removed once the board starts. Withdraw them instead.", "STATE");
    if (added.length && lockedEntries(b)) return fail("Entries are closed once a bracket or schedule starts.", "STATE");
  }
  b.participants = next;
  for (const p of removed) {
    delete b.scores[p.id];
    b.attempts = b.attempts.filter((x) => x.pid !== p.id);
  }
  const gone = new Set(removed.map((p) => p.id));
  b.seeds = [...b.seeds.filter((id) => !gone.has(id)), ...added.map((p) => p.id)];
  b.waiting = waiting;
  return OK;
}

function recordResult(b: Board, a: Extract<Action, { type: "result" }>, env: ActionEnv): Inner {
  const dm = derive(b).matches.find((m) => m.id === a.matchId);
  if (!dm) return fail("That match isn't on this board.", "NOT_FOUND");
  if (dm.state !== "ready" && dm.state !== "done") return fail("That match is still waiting for its players.", "STATE");
  if (dm.a.kind !== "player" || dm.b.kind !== "player") return fail("That match is still waiting for its players.", "STATE");
  const pa = dm.a.id;
  const pb = dm.b.id;
  const scoreA = a.scoreA === undefined ? null : cleanScore(a.scoreA);
  const scoreB = a.scoreB === undefined ? null : cleanScore(a.scoreB);
  if ((a.scoreA != null && scoreA === null) || (a.scoreB != null && scoreB === null)) return fail("Scores must be numbers.");
  let winner = a.winner;
  // Scores alone decide it when no winner is given.
  if (winner === undefined || (winner === null && scoreA !== null && scoreB !== null && scoreA !== scoreB && !allowsDraw(b))) {
    if (scoreA === null || scoreB === null) return fail("Pick the winner.");
    winner = scoreA > scoreB ? pa : scoreB > scoreA ? pb : null;
  }
  if (winner === null && !allowsDraw(b)) return fail(scoreA !== null && scoreA === scoreB ? "It's a tie: pick who won." : "Pick the winner.");
  if (winner !== null && winner !== pa && winner !== pb) return fail("The winner has to be one of the two players.");
  if (scoreA !== null && scoreB !== null && winner !== null && !a.forfeit) {
    const [w, l] = winner === pa ? [scoreA, scoreB] : [scoreB, scoreA];
    const lowWins = b.format === "points" && b.settings.points.order === "low";
    if (lowWins ? w > l : w < l) return fail("The winner's score is lower than the loser's. Check the scores.");
  }
  if (winner === null && scoreA !== null && scoreB !== null && scoreA !== scoreB) return fail("A draw needs equal scores.");
  const result: MatchResult = { a: pa, b: pb, winner, at: env.now };
  if (scoreA !== null) result.scoreA = scoreA;
  if (scoreB !== null) result.scoreB = scoreB;
  if (a.forfeit) result.forfeit = true;

  if (isBracket(b) || b.format === "roundrobin") {
    b.results[a.matchId] = result;
    settled(b, a.matchId);
    return reflow(b, a.force, a.matchId);
  }
  const lm = b.leagueMatches.find((m) => m.id === a.matchId) ?? b.challenges.find((c) => c.id === a.matchId);
  if (!lm) return fail("That match isn't on this board.", "NOT_FOUND");
  lm.result = result;
  settled(b, a.matchId);
  return { ok: true, matchId: a.matchId };
}

/** A decided match leaves the lane queue, and a result (typed in or from the game) ends its
 * game link: a result typed in by hand wins over one the game sends later. */
function settled(b: Board, matchId: string) {
  const m = b.meta[matchId];
  if (!m) return;
  delete m.calledAt;
  delete m.game;
  delete m.note;
  tidyMeta(b, matchId);
}

function tidyMeta(b: Board, matchId: string) {
  const m = b.meta[matchId];
  if (m && !m.lane && !m.calledAt && !m.game && !m.note) delete b.meta[matchId];
}

const allowsDraw = (b: Board) => (b.format === "roundrobin" ? b.settings.roundrobin.allowDraws : b.format === "points");

/** After a bracket change: results that no longer fit would be dropped. Ask first. */
function reflow(b: Board, force: boolean | undefined, matchId: string): Inner {
  const stale = staleResults(b);
  if (stale.length && !force) {
    const d = derive({ ...b, results: {} });
    const labels = new Map(d.matches.map((m) => [m.id, m.label]));
    return {
      ok: false,
      code: "REFLOW",
      error: `This changes who plays later. ${stale.length} later result${stale.length === 1 ? "" : "s"} will be cleared.`,
      affected: stale.map((id) => labels.get(id) ?? id),
    };
  }
  for (const id of stale) delete b.results[id];
  return { ok: true, matchId };
}

export { leagueResultFits };
