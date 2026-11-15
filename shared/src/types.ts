// The board model. A board stores only its inputs: participants, settings, and what the host
// entered (results, round scores, attempts). Everything shown (brackets, standings, "up next")
// is derived from those inputs by the format engines (derive.ts), so an edit or an undo is
// just a change to the inputs, and a bracket re-flows by itself.

export type FormatId = "points" | "single" | "double" | "roundrobin" | "ladder" | "best";
export type BoardStatus = "draft" | "live" | "finished";

export interface Participant {
  id: string;
  name: string;
  /** Team members (optional, display only). */
  members?: string[];
  /** Out of the event: their remaining bracket matches are walkovers; they stay in history. */
  withdrawn?: boolean;
}

/** One played match (brackets, round robin, ladder challenges, league matches). */
export interface MatchResult {
  /** The two participant ids the result was recorded for. A bracket ignores a result whose
   * players no longer match the slot (after an earlier result changed): it's "stale". */
  a: string;
  b: string;
  /** The winner's id, or null for a draw (round robin / league only). */
  winner: string | null;
  /** Optional scores (games won in a best-of, or points). */
  scoreA?: number;
  scoreB?: number;
  /** A walkover / forfeit: the winner advanced without playing. */
  forfeit?: boolean;
  at: number;
}

/** Lane assignment and "call" state for a match ("Board 2", "Table 1"). */
export interface MatchMeta {
  lane?: string;
  /** When the host called it to the lane (ms). Ready matches with a lane queue in this order. */
  calledAt?: number;
  /** Being played in a game on the box (SDK 0.15.0 matches). Set and cleared by the server. */
  game?: GameLink;
  /** A word for the host about the last game link ("Room AB12 closed without a result"). */
  note?: string;
}

/** A bracket match being played in another game on the box. */
export interface GameLink {
  /** The match id the box knows it by (unique per start). */
  box: string;
  gameId: string;
  /** The game's name ("Pool"). */
  game: string;
  room: string;
  joinUrl?: string;
  /** The two participant ids it was started for: a re-flowed bracket that changed them drops it. */
  a: string;
  b: string;
  at: number;
}

export type SortOrder = "high" | "low";

export type PointsTiebreak = "bestRound" | "lastRound" | "mostRoundWins";
export type LeagueTiebreak = "headToHead" | "wins" | "diff" | "scored";

export interface PointsSettings {
  /** "rounds": free-form scores per round (trivia). "matches": W/D/L games between participants (a league table). */
  scoring: "rounds" | "matches";
  rounds: { id: string; name: string }[];
  order: SortOrder;
  tiebreaks: PointsTiebreak[];
  /** matches scoring: */
  win: number;
  draw: number;
  loss: number;
  leagueTiebreaks: LeagueTiebreak[];
}

export interface BracketSettings {
  /** How the bracket was seeded (for display); the order of `seeds` is the seeding. */
  seeding: "manual" | "random" | "board";
  thirdPlace: boolean;
  /** Double elimination: the winners-bracket champion must lose twice. */
  bracketReset: boolean;
  bestOf: number;
}

export interface RoundRobinSettings {
  groups: number;
  /** Each pair plays this many times (1 or 2). */
  legs: number;
  win: number;
  draw: number;
  loss: number;
  allowDraws: boolean;
  bestOf: number;
  leagueTiebreaks: LeagueTiebreak[];
  /** How many per group a knockout board takes (0: none). */
  advance: number;
}

export interface LadderSettings {
  /** How many places above themselves a challenger may challenge (0: anyone above). */
  reach: number;
  bestOf: number;
}

export interface BestSettings {
  order: SortOrder;
  /** "points" (darts high score), "time" (fastest; values are seconds), "number". */
  unit: "points" | "time" | "number";
  /** Attempts per participant (0: unlimited). */
  maxAttempts: number;
  label: string;
}

export interface FormatSettings {
  points: PointsSettings;
  single: BracketSettings;
  double: BracketSettings;
  roundrobin: RoundRobinSettings;
  ladder: LadderSettings;
  best: BestSettings;
}

export interface LadderChallenge {
  id: string;
  challenger: string;
  defender: string;
  /** Unset until played. */
  result?: MatchResult;
  createdAt: number;
}

export interface LeagueMatch {
  id: string;
  a: string;
  b: string;
  result?: MatchResult;
  createdAt: number;
}

export interface Attempt {
  id: string;
  pid: string;
  value: number;
  at: number;
}

export type BackgroundKind = "solid" | "gradient" | "image";
export type TitleStyle = "bold" | "neon" | "chalk" | "classic" | "marquee";

export interface Theme {
  preset: string;
  accent: string;
  accent2: string;
  text: string;
  background: { kind: BackgroundKind; color: string; color2: string; image?: string };
  titleStyle: TitleStyle;
  emoji: string;
  /** Uploaded sponsor / logo image id. */
  logo?: string;
  /** Use the venue's colors from the box instead of the accent and background above. */
  useVenue: boolean;
}

/** Who plays: single players, or teams (pairs when size is 2). Teams are participants with
 * members; players not on a team yet wait on the board's `waiting` list. */
export interface EntrySettings {
  kind: "players" | "teams";
  /** Players per team (0: any number). */
  size: number;
}

export interface SeasonLink {
  /** Board ids summed into this one (any format: their standings' places count). */
  boards: string[];
  /** "placement": points per place (placePoints[0] for 1st…); "total": each board's total score. */
  scoring: "placement" | "total";
  placePoints: number[];
  /** Nights that weren't run on a board here (a trivia game's results), typed or pasted in. */
  nights?: SeasonNight[];
  /** Spellings that are the same team or player: a name's key → the name to count it as. */
  aliases?: Record<string, string>;
}

export interface SeasonNight {
  id: string;
  title: string;
  /** The night's date (ms), for the column order. */
  at: number;
  results: { name: string; place: number; score?: number }[];
}

export interface Board {
  id: string;
  title: string;
  /** Small print under the title ("Thursdays at 8"). */
  subtitle: string;
  format: FormatId;
  status: BoardStatus;
  kind: "nightly" | "season";
  /** Bumped by every change; edits carry the version they were made against. */
  version: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  participants: Participant[];
  entry: EntrySettings;
  /** Team boards: players not on a team yet (names). Not shown to the public screens. */
  waiting: string[];
  /** The board this one was copied from (last week's), for "keep last week's finalists apart". */
  copiedFrom?: string;
  /** Bracket seeding order (participant ids), and the ladder's starting order. */
  seeds: string[];
  /** Round robin groups (participant ids per group), fixed when the board starts. */
  groups?: string[][];
  settings: FormatSettings;
  /** Bracket and round robin results, by match id. */
  results: Record<string, MatchResult>;
  /** Points table (rounds): scores[participantId][roundId]. */
  scores: Record<string, Record<string, number>>;
  /** Points table (matches) and ladder. */
  leagueMatches: LeagueMatch[];
  challenges: LadderChallenge[];
  attempts: Attempt[];
  meta: Record<string, MatchMeta>;
  lanes: string[];
  theme: Theme;
  season?: SeasonLink;
  /** Set when finished: who won (names), for history. */
  winners?: string[];
  /** The latest change (set by the server), so screens can highlight what just happened. */
  lastChange?: { at: number; type: string; matchId?: string };
  /** Scorekeeper PIN: only its generation and a hash are stored; tokens carry the generation. */
  pin?: { hash: string; salt: string; gen: number };
}

// ----------------------------------------------------------------- derived views

export type SlotState =
  | { kind: "player"; id: string }
  | { kind: "bye" }
  | { kind: "pending"; from: string; /** Waiting on that match's loser (not its winner). */ loser?: boolean };

export interface DerivedMatch {
  id: string;
  /** "W" winners / main bracket, "L" losers bracket, "GF" grand final, "GF2" reset,
   * "3P" third place, "RR" round robin, "LG" league / ladder. */
  section: "W" | "L" | "GF" | "GF2" | "3P" | "RR" | "LG";
  round: number;
  index: number;
  /** Round robin group (0-based). */
  group?: number;
  label: string;
  a: SlotState;
  b: SlotState;
  /** ready: both players known, no result. done: decided. bye: auto-advance (hidden).
   * waiting: a slot isn't known yet. skipped: not needed (the reset when it isn't played). */
  state: "waiting" | "ready" | "done" | "bye" | "skipped";
  result?: MatchResult;
  winner?: string;
  loser?: string;
  /** Where the winner and loser go (bracket match ids), for drawing and for warnings. */
  winnerTo?: string;
  loserTo?: string;
  lane?: string;
  calledAt?: number;
  /** Being played in a game on the box: "Pool, room AB12". */
  game?: { name: string; room: string; joinUrl?: string };
  /** For the host: what happened to the last game link. */
  note?: string;
}

export interface StandingRow {
  id: string;
  name: string;
  place: number;
  /** The headline number (total, points, best). */
  value: number | null;
  /** Format-specific columns: round scores, P/W/D/L, attempts… */
  cells: Record<string, number | string | null>;
  /** Eliminated / withdrawn. */
  out?: boolean;
  group?: number;
}

export interface Column {
  key: string;
  label: string;
  /** "num" right-aligned number, "time" mm:ss.s */
  type?: "num" | "time" | "text";
}

export interface DerivedBoard {
  matches: DerivedMatch[];
  standings: StandingRow[];
  columns: Column[];
  /** Ready matches with their lanes, in call order: what's on next. */
  upNext: DerivedMatch[];
  /** Everything decided: the board can be finished. */
  complete: boolean;
  /** Final placings (bracket) or standings leaders, once complete. */
  champion?: string;
  /** Round robin: the standings per group. */
  groupStandings?: StandingRow[][];
}
