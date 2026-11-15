// Regulars: who has played on earlier boards, so a host can tick tonight's players instead of
// typing them, and the quick-add field can suggest names. People are matched by name (there
// are no player accounts): "Alex" and "Alex B." are two people.

import type { Board } from "./types.js";

export interface PlayerSeen {
  name: string;
  /** Boards they were on (as a player or a team member). */
  times: number;
  lastAt: number;
  /** Theme presets and formats of those boards, for "this kind of night". */
  presets: string[];
  formats: string[];
}

export interface TeamSeen extends PlayerSeen {
  members: string[];
  /** Boards this team won. */
  won: number;
}

export interface PeopleSeen {
  players: PlayerSeen[];
  teams: TeamSeen[];
}

const MAX = 400;

export function peopleSeen(boards: Board[], exclude?: string): PeopleSeen {
  const players = new Map<string, PlayerSeen>();
  const teams = new Map<string, TeamSeen>();
  const note = (map: Map<string, PlayerSeen>, name: string, b: Board, at: number) => {
    const key = name.toLowerCase();
    let p = map.get(key);
    if (!p) {
      p = { name, times: 0, lastAt: 0, presets: [], formats: [] };
      map.set(key, p);
    }
    p.times++;
    if (at >= p.lastAt) {
      p.lastAt = at;
      p.name = name; // the latest spelling
    }
    if (!p.presets.includes(b.theme.preset)) p.presets.push(b.theme.preset);
    if (!p.formats.includes(b.format)) p.formats.push(b.format);
    return p;
  };
  for (const b of boards) {
    if (b.id === exclude || b.status === "draft" || b.kind === "season") continue;
    const at = b.startedAt ?? b.createdAt;
    for (const p of b.participants) {
      // On a team board every entrant is a team, even one nobody listed members for.
      if (p.members?.length || b.entry?.kind === "teams") {
        const t = note(teams as Map<string, PlayerSeen>, p.name, b, at) as TeamSeen;
        t.won ??= 0;
        if (t.lastAt === at || !t.members) t.members = [...(p.members ?? [])];
        if (b.winners?.includes(p.name)) t.won++;
        for (const m of p.members ?? []) note(players, m, b, at);
      } else {
        note(players, p.name, b, at);
      }
    }
  }
  const order = (x: PlayerSeen, y: PlayerSeen) => y.lastAt - x.lastAt || y.times - x.times || x.name.localeCompare(y.name);
  return {
    players: [...players.values()].sort(order).slice(0, MAX),
    teams: [...teams.values()].sort(order).slice(0, MAX),
  };
}

/** Letters and digits only, lower case: "The Quiz-Wizards!" → "thequizwizards". */
const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Names that look like the same team or player spelled another way ("Quizards", "the
 * quizzards", "Quiz Wizards!"), so a host picks the existing one instead of splitting the
 * standings. An exact match (case aside) isn't "similar": it's the same name.
 */
export function similarNames(name: string, candidates: string[], limit = 3): string[] {
  const n = squash(name);
  if (n.length < 4) return [];
  const exact = name.trim().toLowerCase();
  const max = n.length <= 5 ? 1 : 2;
  const out: { name: string; d: number }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const k = c.trim().toLowerCase();
    if (k === exact || seen.has(k)) continue;
    seen.add(k);
    const s = squash(c);
    if (!s) continue;
    const d = s === n ? 0 : distance(n, s, max);
    if (d <= max) out.push({ name: c, d });
  }
  return out.sort((x, y) => x.d - y.d).slice(0, limit).map((x) => x.name);
}
