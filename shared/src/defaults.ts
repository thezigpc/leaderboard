// Default settings, the theme presets, and limits.

import type { Board, FormatId, FormatSettings, Theme } from "./types.js";

export const DEFAULT_NAME = "Leaderboard";

export const LIMITS = {
  title: 60,
  subtitle: 80,
  name: 40,
  members: 8,
  participants: 128,
  rounds: 20,
  lanes: 16,
  laneName: 24,
  attempts: 2000,
  leagueMatches: 2000,
  challenges: 2000,
  boards: 300,
  score: 1_000_000,
  pinMin: 4,
  pinMax: 8,
  seasonBoards: 52,
} as const;

export const FORMAT_NAMES: Record<FormatId, string> = {
  points: "Points table",
  single: "Single elimination",
  double: "Double elimination",
  roundrobin: "Round robin",
  ladder: "Ladder",
  best: "Best score",
};

export const FORMAT_HINTS: Record<FormatId, string> = {
  points: "Scores per round, or a league table of wins and losses. Trivia nights, weekly leagues.",
  single: "A knockout bracket: lose once and you're out.",
  double: "Lose twice and you're out: a winners and a losers bracket, then a grand final.",
  roundrobin: "Everyone plays everyone (optionally in groups), ranked on a points table.",
  ladder: "A ranked list: beat someone above you and take their place. Runs for weeks.",
  best: "One number per attempt (high score, fastest time); best attempt counts.",
};

export function defaultRounds(count = 6): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i + 1}`, name: `R${i + 1}` }));
}

export function defaultSettings(): FormatSettings {
  return {
    points: {
      scoring: "rounds",
      rounds: defaultRounds(6),
      order: "high",
      tiebreaks: ["lastRound", "bestRound"],
      win: 3,
      draw: 1,
      loss: 0,
      leagueTiebreaks: ["headToHead", "wins", "diff"],
    },
    single: { seeding: "manual", thirdPlace: false, bracketReset: true, bestOf: 1 },
    double: { seeding: "manual", thirdPlace: false, bracketReset: true, bestOf: 1 },
    roundrobin: { groups: 1, legs: 1, win: 3, draw: 1, loss: 0, allowDraws: false, bestOf: 1, leagueTiebreaks: ["headToHead", "wins", "diff"], advance: 0 },
    ladder: { reach: 3, bestOf: 1 },
    best: { order: "high", unit: "points", maxAttempts: 0, label: "Score" },
  };
}

export interface ThemePreset {
  id: string;
  name: string;
  theme: Omit<Theme, "preset">;
}

/** Original looks for common events. No league or TV-show marks anywhere. */
export const PRESETS: ThemePreset[] = [
  {
    id: "classic",
    name: "Classic",
    theme: { accent: "#ffb703", accent2: "#219ebc", text: "#f5f7fa", background: { kind: "gradient", color: "#0f1724", color2: "#1d2b44" }, titleStyle: "bold", emoji: "🏆", useVenue: true },
  },
  {
    id: "trivia",
    name: "Trivia Night",
    theme: { accent: "#c77dff", accent2: "#4cc9f0", text: "#f8f4ff", background: { kind: "gradient", color: "#1a0b2e", color2: "#3c096c" }, titleStyle: "neon", emoji: "🧠", useVenue: false },
  },
  {
    id: "cornhole",
    name: "Cornhole",
    theme: { accent: "#f4a259", accent2: "#5b8e7d", text: "#fff8ec", background: { kind: "gradient", color: "#2d1e12", color2: "#5a3b22" }, titleStyle: "marquee", emoji: "🌽", useVenue: false },
  },
  {
    id: "pool",
    name: "Pool",
    theme: { accent: "#ffd166", accent2: "#06d6a0", text: "#f1fff9", background: { kind: "gradient", color: "#04342c", color2: "#0b6e4f" }, titleStyle: "classic", emoji: "🎱", useVenue: false },
  },
  {
    id: "darts",
    name: "Darts",
    theme: { accent: "#ef233c", accent2: "#edf2f4", text: "#ffffff", background: { kind: "gradient", color: "#111111", color2: "#2b2d42" }, titleStyle: "bold", emoji: "🎯", useVenue: false },
  },
  {
    id: "holiday",
    name: "Holiday",
    theme: { accent: "#e63946", accent2: "#2a9d8f", text: "#fffdf7", background: { kind: "gradient", color: "#0b3d2e", color2: "#14532d" }, titleStyle: "chalk", emoji: "🎄", useVenue: false },
  },
  {
    id: "final",
    name: "Tournament Final",
    theme: { accent: "#ffd700", accent2: "#e5e5e5", text: "#fffbea", background: { kind: "gradient", color: "#121212", color2: "#3a2e05" }, titleStyle: "marquee", emoji: "👑", useVenue: false },
  },
];

export function presetTheme(id: string): Theme {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { preset: p.id, ...structuredClone(p.theme) };
}

/** The new-board picker: each event starts with a look, a format and who plays. */
export const EVENTS: { preset: string; name: string; title: string; format: FormatId; entry: "players" | "pairs" | "teams" }[] = [
  { preset: "trivia", name: "Trivia", title: "Trivia Night", format: "points", entry: "teams" },
  { preset: "cornhole", name: "Cornhole", title: "Cornhole", format: "single", entry: "pairs" },
  { preset: "pool", name: "Pool", title: "Pool", format: "single", entry: "players" },
  { preset: "darts", name: "Darts", title: "Darts", format: "best", entry: "players" },
  { preset: "holiday", name: "Holiday", title: "Holiday Party", format: "points", entry: "teams" },
  { preset: "final", name: "Final", title: "Tournament Final", format: "single", entry: "players" },
  { preset: "classic", name: "Other", title: "", format: "points", entry: "players" },
];

/** Made-up team names for a blind draw. Original, generic bar-night phrases. */
export const TEAM_NAMES = [
  "Night Owls", "Long Shots", "Top Shelf", "Last Call", "Table Turners", "Sharp Shooters", "Wild Cards", "Dark Horses",
  "Underdogs", "High Rollers", "Hot Streak", "Front Runners", "Late Bloomers", "Second Wind", "Big Shots", "Lucky Breaks",
  "Slow Starters", "Happy Accidents", "Close Calls", "Full House", "Bar Flies", "Free Throws", "Home Team", "Rookies",
  "Old Pros", "Comeback Kids", "Fair Play", "Good Sports", "Quick Draws", "Steady Hands", "Long Pours", "Tall Orders",
  "Odd Socks", "Pocket Change", "Snack Break", "Tab Openers", "Chalk Dust", "Corner Pocket", "Bullseyes", "Bean Counters",
];

/** A sensible preset for a new board of this format. */
export const presetFor = (format: FormatId): string => (format === "points" ? "trivia" : format === "best" ? "darts" : "classic");

export function newBoard(id: string, title: string, format: FormatId, now: number): Board {
  return {
    id,
    title,
    subtitle: "",
    format,
    status: "draft",
    kind: "nightly",
    version: 1,
    createdAt: now,
    updatedAt: now,
    participants: [],
    entry: { kind: "players", size: 0 },
    waiting: [],
    seeds: [],
    settings: defaultSettings(),
    results: {},
    scores: {},
    leagueMatches: [],
    challenges: [],
    attempts: [],
    meta: {},
    lanes: [],
    theme: presetTheme(presetFor(format)),
  };
}
