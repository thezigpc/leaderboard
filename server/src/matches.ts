// Bracket matches played in other games on the box (SDK 0.15.0, "tournaments": true).
//
// A host taps "Play in Pool" on a ready match: the box makes a room in that game for the two
// players (MatchStart), and the match card shows "Pool, room AB12". When the game reports a
// result the box sends "match_result": place 1 wins, and the bracket moves on as if the host
// had tapped the winner. A room that closes without a result cancels the match: it's ready
// again, with a note. A result typed in by hand always wins: it clears the link, and a result
// the game sends later for it is ignored.
//
// Off a box there are no games to play in, and nothing here runs.

import type { MatchGame, MatchRecord } from "@bargames/sdk";
import type { BarGames } from "@bargames/sdk/server";
import { log } from "@bargames/gamekit/server";
import { derive, liveGameLink, type Board, type DerivedMatch, type GameLink } from "@leaderboard/shared";
import { newId, type ApplyOutcome, type BoardService } from "./boards.js";

/** Every match here is two sides. */
const SIDES = 2;
const GAMES_TTL_MS = 15_000;

export class MatchLinks {
  private cache: { at: number; games: MatchGame[] } | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private bg: BarGames,
    private boards: BoardService,
    private now: () => number = Date.now,
  ) {
    bg.matches.onResult((m) => this.onResult(m));
  }

  /** Games on the box that can play a two-sided match. */
  async games(): Promise<MatchGame[]> {
    if (!this.bg.connected) return [];
    const t = this.now();
    if (this.cache && t - this.cache.at < GAMES_TTL_MS) return this.cache.games;
    let games: MatchGame[] = [];
    try {
      games = (await this.bg.matches.games()).filter((g) => g && typeof g.id === "string" && g.players && g.players.min <= SIDES && g.players.max >= SIDES);
    } catch (err) {
      log.warn("matches", "could not list the box's games", { err: String(err) });
    }
    this.cache = { at: t, games };
    return games;
  }

  /** Starts a ready match in a game on the box. */
  async start(boardId: string, matchId: string, gameId: string): Promise<ApplyOutcome> {
    const b = this.boards.get(boardId);
    if (!b) return { ok: false, status: 404, error: "That board is gone." };
    if (b.status !== "live") return { ok: false, status: 400, error: "Start the board first." };
    const m = derive(this.boards.effective(b)).matches.find((x) => x.id === matchId);
    if (!m) return { ok: false, status: 404, error: "That match isn't on this board." };
    if (m.state !== "ready" || m.a.kind !== "player" || m.b.kind !== "player") return { ok: false, status: 400, error: "Only a match with both sides known and no result can be played." };
    if (liveGameLink(b, m)) return { ok: false, status: 409, error: "That match is already being played." };
    const game = (await this.games()).find((g) => g.id === gameId);
    if (!game) return { ok: false, status: 400, error: "That game can't play this match on the box right now." };
    const names = new Map(b.participants.map((p) => [p.id, p.name]));
    const a = m.a.id;
    const c = m.b.id;
    // Unique per start, so a match played again after a cancelled room gets a fresh room.
    const box = `${b.id}.${m.id}.${newId(4)}`;
    let rec: MatchRecord;
    try {
      rec = await this.bg.matches.start({
        gameId,
        matchId: box,
        players: [
          { name: names.get(a) ?? "?", id: a },
          { name: names.get(c) ?? "?", id: c },
        ],
        title: `${b.title}: ${m.label}`.slice(0, 80),
      });
    } catch (err) {
      log.warn("matches", "the box didn't start the match", { board: b.id, match: m.id, err: String(err) });
      return { ok: false, status: 502, error: `The box couldn't start it in ${game.name}: ${String((err as Error).message ?? err)}` };
    }
    log.info("matches", "started", { board: b.id, match: m.id, game: gameId, room: rec.roomCode });
    return this.link(b.id, m.id, {
      game: { box, gameId, game: game.name, room: rec.roomCode, ...(rec.joinUrl ? { joinUrl: rec.joinUrl } : {}), a, b: c, at: this.now() },
    });
  }

  /** The box's "match_result": a game finished (or cancelled) a match we started. */
  async onResult(rec: MatchRecord): Promise<void> {
    const found = this.find(rec.matchId);
    if (!found) {
      // A result typed in by hand already cleared the link, or the board is gone.
      log.info("matches", "result for a match that isn't waiting on a game", { match: rec.matchId, status: rec.status });
      return;
    }
    const { board, match } = found;
    const g = board.meta[match.id]!.game!;
    if (rec.status === "cancelled") {
      await this.link(board.id, match.id, { game: null, note: `${g.game} room ${g.room} closed without a result. Play it again or enter the result.` });
      return;
    }
    if (rec.status !== "done") return;
    const winner = winnerOf(rec, g);
    if (!winner) {
      await this.link(board.id, match.id, { game: null, note: `${g.game} room ${g.room} ended without a clear winner. Enter the result.` });
      return;
    }
    let scores = scoresOf(rec, g);
    // A game whose score runs the other way (balls left, strokes) still decides the winner;
    // its scores just aren't the bracket's kind.
    if (scores && (winner === g.a ? scores[0] < scores[1] : scores[1] < scores[0])) scores = undefined;
    const r = await this.boards.apply(board.id, board.version, {
      type: "result",
      matchId: match.id,
      winner,
      ...(scores ? { scoreA: scores[match.a.kind === "player" && match.a.id === g.a ? 0 : 1], scoreB: scores[match.a.kind === "player" && match.a.id === g.a ? 1 : 0] } : {}),
    });
    if (!r.ok) {
      log.warn("matches", "the game's result didn't fit", { board: board.id, match: match.id, err: r.error });
      await this.link(board.id, match.id, { game: null, note: `${g.game} reported a result that couldn't be recorded (${r.error}). Enter it by hand.` });
      return;
    }
    log.info("matches", "result from the game", { board: board.id, match: match.id, room: g.room });
  }

  /**
   * Asks the box about matches still being played: catches a result sent while this app was
   * restarting. Runs once at start and then every few minutes.
   */
  async poll(): Promise<void> {
    if (!this.bg.connected) return;
    for (const b of this.boards.all()) {
      if (b.status !== "live") continue;
      for (const meta of Object.values(b.meta)) {
        if (!meta.game) continue;
        const rec = await this.bg.matches.get(meta.game.box).catch(() => undefined);
        if (rec && rec.status !== "playing") await this.onResult(rec);
      }
    }
  }

  every(ms: number): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), ms);
    this.timer.unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private find(box: string): { board: Board; match: DerivedMatch } | undefined {
    const boardId = box.split(".")[0];
    const b = this.boards.get(boardId);
    if (!b) return undefined;
    const d = derive(this.boards.effective(b));
    for (const [id, meta] of Object.entries(b.meta)) {
      if (meta.game?.box !== box) continue;
      const m = d.matches.find((x) => x.id === id);
      // The bracket re-flowed and this match has other players now: the game's result is moot.
      if (!m || !liveGameLink(b, m)) return undefined;
      return { board: b, match: m };
    }
    return undefined;
  }

  private async link(boardId: string, matchId: string, a: { game: GameLink | null; note?: string }): Promise<ApplyOutcome> {
    const b = this.boards.get(boardId);
    if (!b) return { ok: false, status: 404, error: "That board is gone." };
    return this.boards.apply(boardId, b.version, { type: "gameLink", matchId, game: a.game, ...(a.note ? { note: a.note } : {}) });
  }
}

/** Place 1 wins; the player is matched by the id we sent, then by name. */
function winnerOf(rec: MatchRecord, g: { a: string; b: string }): string | undefined {
  const results = rec.result?.results ?? [];
  const firsts = results.filter((r) => r.place === 1);
  let top = firsts.length === 1 ? firsts[0] : undefined;
  if (!top && !firsts.length && results.length === 2 && results.every((r) => typeof r.score === "number") && results[0].score !== results[1].score)
    top = results[0].score! > results[1].score! ? results[0] : results[1];
  if (!top) return undefined;
  return idOf(rec, g, top.player.name);
}

function idOf(rec: MatchRecord, g: { a: string; b: string }, name: string): string | undefined {
  const p = rec.players.find((x) => x.name === name) ?? rec.players.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (p?.id === g.a || p?.id === g.b) return p.id;
  const i = p ? rec.players.indexOf(p) : -1;
  return i === 0 ? g.a : i === 1 ? g.b : undefined;
}

/** Both sides' scores, as [g.a's, g.b's], when the game gave both. */
function scoresOf(rec: MatchRecord, g: { a: string; b: string }): [number, number] | undefined {
  const results = rec.result?.results ?? [];
  let sa: number | undefined;
  let sb: number | undefined;
  for (const r of results) {
    if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0) continue;
    const id = idOf(rec, g, r.player.name);
    if (id === g.a) sa = r.score;
    else if (id === g.b) sb = r.score;
  }
  return sa !== undefined && sb !== undefined ? [sa, sb] : undefined;
}
