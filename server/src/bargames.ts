// The app's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and the app runs
// exactly as it does standalone: that's guaranteed by the SDK.
//
// An app has no rooms. What it gives the box: events for Home Assistant and the live feed
// (x-leaderboard-board-started, -result, -leader-changed, -board-finished, and the standard
// "winner" when a board finishes), a finished board's placings for "Tonight's winners" (which
// also sends "game_result"), a countdown, and "needs attention" items.

import { createBarGames, type AttentionItem, type BarGames, type GameEventInput } from "@bargames/sdk/server";
import { log } from "@bargames/gamekit/server";
import { leaders, type Board, type DerivedBoard, type DerivedMatch } from "@leaderboard/shared";

export function makeBarGames(opts: { coreUrl?: string; token?: string; defaultName: string }): BarGames {
  const bg = createBarGames({ gameId: "leaderboard", defaultName: opts.defaultName, coreUrl: opts.coreUrl, token: opts.token });
  // The box asks every package for status; an app has no rooms to list.
  bg.setStatusProvider(() => ({ rooms: [] }));
  return bg;
}

/** The app's own events (declared in bargames.json). Custom events start with "x-" (the box
 * rejects any other non-standard name); "winner" is the standard one. */
export const EVENTS = {
  started: "x-leaderboard-board-started",
  result: "x-leaderboard-result",
  leader: "x-leaderboard-leader-changed",
  finished: "x-leaderboard-board-finished",
} as const;
const emit = (bg: BarGames, type: GameEventInput["type"], data: Record<string, unknown>) => bg.emit({ type, data });

const nameIn = (b: Board) => {
  const names = new Map(b.participants.map((p) => [p.id, p.name]));
  return (id: string | undefined) => (id ? names.get(id) : undefined);
};

/**
 * Tells the box what a change did: compares the board before and after.
 * Fire-and-forget: the SDK queues and never throws; off a box nothing is sent.
 */
export function announceChange(
  bg: BarGames,
  before: { board: Board; derived: DerivedBoard },
  after: { board: Board; derived: DerivedBoard },
  action: { type: string; matchId?: string; pid?: string; value?: unknown },
): void {
  if (!bg.connected) return;
  const b = after.board;
  const name = nameIn(b);
  const base = { boardId: b.id, title: b.title, format: b.format };
  if (before.board.status === "draft" && b.status === "live") emit(bg, EVENTS.started, { ...base, entrants: b.participants.length });

  if (action.type === "result" && action.matchId) {
    const m: DerivedMatch | undefined = after.derived.matches.find((x) => x.id === action.matchId);
    if (m?.result) {
      emit(bg, EVENTS.result, {
        ...base,
        match: m.label,
        winner: m.result.winner ? name(m.result.winner) : null,
        loser: m.result.winner ? name(m.result.winner === m.result.a ? m.result.b : m.result.a) : null,
        draw: m.result.winner === null,
        // Winner's score first ("7-2").
        score:
          m.result.scoreA !== undefined && m.result.scoreB !== undefined
            ? m.result.winner === m.result.b
              ? `${m.result.scoreB}-${m.result.scoreA}`
              : `${m.result.scoreA}-${m.result.scoreB}`
            : undefined,
        lane: m.lane,
      });
    }
  } else if ((action.type === "score" || action.type === "attempt") && action.pid) {
    emit(bg, EVENTS.result, { ...base, name: name(action.pid), value: action.value ?? null });
  }

  if (b.status === "live") {
    const was = leaders(before.derived);
    const now = leaders(after.derived);
    if (now.length === 1 && (was.length !== 1 || was[0] !== now[0])) emit(bg, EVENTS.leader, { ...base, leader: name(now[0]) });
  }

  if (before.board.status !== "finished" && b.status === "finished") {
    emit(bg, EVENTS.finished, { ...base, winners: b.winners ?? [] });
    for (const name of b.winners ?? []) emit(bg, "winner", { name, ...base });
    // "Tonight's winners" on the box counts the event's winners.
    const results = after.derived.standings
      .filter((r) => r.place > 0 && !r.out)
      .slice(0, 50)
      .map((r) => ({ player: { name: r.name }, place: r.place, ...(typeof r.value === "number" ? { score: r.value } : {}) }));
    if (results.length) void bg.reportResults({ results }).catch((err) => log.warn("bargames", "results not reported", { err: String(err) }));
  }
}

/** Sends the box the "needs attention" list only when it changes. */
export function attentionReporter(bg: BarGames) {
  let last = "[]";
  return (items: AttentionItem[]) => {
    if (!bg.connected) return;
    const json = JSON.stringify(items);
    if (json === last) return;
    last = json;
    void bg.setAttention(items).catch((err) => log.warn("bargames", "attention not sent", { err: String(err) }));
  };
}

/** Matches called to a lane that have waited too long for a result. */
export function waitingTooLong(boards: { board: Board; derived: DerivedBoard }[], minutes: number, now: number): AttentionItem[] {
  if (!minutes) return [];
  const items: AttentionItem[] = [];
  for (const { board, derived } of boards) {
    if (board.status !== "live") continue;
    const name = nameIn(board);
    for (const m of derived.upNext) {
      if (!m.calledAt || now - m.calledAt < minutes * 60_000) continue;
      const who = [m.a, m.b].map((s) => (s.kind === "player" ? name(s.id) : "?")).join(" vs ");
      const waited = Math.floor((now - m.calledAt) / 60_000);
      items.push({
        level: "warn",
        message: `${board.title}: ${who}${m.lane ? ` on ${m.lane}` : ""} has waited ${waited} min for a result`,
        actionPath: `/host/${board.id}`,
      });
    }
  }
  return items.slice(0, 20);
}
