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
      if (p.members?.length) {
        const t = note(teams as Map<string, PlayerSeen>, p.name, b, at) as TeamSeen;
        t.won ??= 0;
        if (t.lastAt === at || !t.members) t.members = [...p.members];
        if (b.winners?.includes(p.name)) t.won++;
        for (const m of p.members) note(players, m, b, at);
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
