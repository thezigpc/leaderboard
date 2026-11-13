// The boards: kept in memory, each written to DATA_DIR/boards/<id>.json (atomically, one
// write at a time per board). Every change goes through applyAction from @leaderboard/shared
// with the board's version, so two phones editing at once can't lose a result: the second
// one is told the board changed and gets the latest.

import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { log, type JsonStore } from "@bargames/gamekit/server";
import {
  applyAction,
  derive,
  LIMITS,
  newBoard,
  presetTheme,
  qualifiers,
  withSeason,
  type Action,
  type ActionResult,
  type Board,
  type BoardSummary,
  type BoardView,
  type DerivedBoard,
  type FormatId,
  type PublicBoard,
} from "@leaderboard/shared";

const UNDO_DEPTH = 50;

/** Short random ids (lowercase letters and digits). */
export const newId = (len = 10): string => {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
};

const ID_RE = /^[a-z0-9]{6,20}$/;
export const validBoardId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

export interface ChangeEvent {
  before: { board: Board; derived: DerivedBoard };
  after: { board: Board; derived: DerivedBoard };
  action: { type: string; matchId?: string; pid?: string; value?: unknown };
}

export type ApplyOutcome =
  | { ok: true; view: BoardView }
  | { ok: false; status: number; error: string; code?: string; affected?: string[]; view?: BoardView };

export class BoardService {
  private boards = new Map<string, Board>();
  private undo = new Map<string, Board[]>();
  private writes = new Map<string, Promise<void>>();
  /** Called after every saved change (broadcast, box events). */
  onChange: (e: ChangeEvent) => void = () => {};
  /** Called when a board's view may have changed without an action (a linked board changed). */
  onRefresh: (id: string) => void = () => {};
  onRemove: (id: string) => void = () => {};

  constructor(
    private store: JsonStore,
    private now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    let files: string[] = [];
    try {
      files = await readdir(path.join(this.store.dir, "boards"));
    } catch {
      return; // no boards yet
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const b = await this.store.read<Board>(`boards/${f}`, isBoard);
      if (b && validBoardId(b.id)) this.boards.set(b.id, upgrade(b));
    }
    log.info("boards", "loaded", { count: this.boards.size });
  }

  get(id: string): Board | undefined {
    return this.boards.get(id);
  }

  all(): Board[] {
    return [...this.boards.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The board as the engines see it (a season board pulls in its linked boards). */
  effective(b: Board): Board {
    return b.season?.boards.length ? withSeason(b, b.season.boards.map((id) => this.boards.get(id))) : b;
  }

  derived(b: Board): DerivedBoard {
    return derive(this.effective(b));
  }

  view(b: Board): BoardView {
    const eff = this.effective(b);
    return { board: publicBoard(eff, b), derived: derive(eff) };
  }

  summary(b: Board): BoardSummary {
    const d = this.derived(b);
    const names = new Map(this.effective(b).participants.map((p) => [p.id, p.name]));
    const first = d.champion ?? (d.standings.filter((r) => r.place === 1).length === 1 ? d.standings.find((r) => r.place === 1)!.id : undefined);
    return {
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      format: b.format,
      status: b.status,
      kind: b.kind,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
      winners: b.winners,
      participants: this.effective(b).participants.length,
      leader: b.status === "finished" ? b.winners?.join(" & ") : first ? names.get(first) : undefined,
      theme: b.theme,
      hasPin: !!b.pin,
      version: b.version,
    };
  }

  summaries(): BoardSummary[] {
    return this.all().map((b) => this.summary(b));
  }

  async create(input: {
    title: string;
    format: FormatId;
    preset?: string;
    copyFrom?: string;
    keepEntrants?: boolean;
    seedFrom?: { boardId: string; top: number };
  }): Promise<ApplyOutcome> {
    if (this.boards.size >= LIMITS.boards) return { ok: false, status: 400, error: `There are ${LIMITS.boards} boards already. Delete some old ones in Admin first.` };
    const now = this.now();
    const title = typeof input.title === "string" ? input.title : "";
    const format: FormatId = ["points", "single", "double", "roundrobin", "ladder", "best"].includes(input.format) ? input.format : "points";
    let b = newBoard(newId(), "New board", format, now);
    const env = { now, newId: () => newId(8), random: Math.random };
    const step = (a: Action): ApplyOutcome | null => {
      const r = applyAction(b, a, env);
      if (!r.ok) return { ok: false, status: 400, error: r.error };
      b = r.board;
      return null;
    };
    const src = input.copyFrom ? this.boards.get(input.copyFrom) : undefined;
    if (input.copyFrom && !src) return { ok: false, status: 404, error: "That board is gone." };
    if (src) {
      // A template: same format, settings, look and lanes; optionally the same entrants.
      b = { ...b, format: src.format, subtitle: src.subtitle, kind: src.kind, settings: structuredClone(src.settings), theme: structuredClone(src.theme), lanes: [...src.lanes] };
      if (src.season) b.season = structuredClone(src.season);
      if (input.keepEntrants && src.participants.length) {
        const fail = step({ type: "addParticipants", names: [src.participants.filter((p) => !p.withdrawn).map((p) => (p.members?.length ? `${p.name}: ${p.members.join(", ")}` : p.name)).join("\n")] });
        if (fail) return fail;
      }
    } else if (input.preset) {
      b.theme = presetTheme(input.preset);
    }
    if (input.seedFrom) {
      const from = this.boards.get(input.seedFrom.boardId);
      if (!from) return { ok: false, status: 404, error: "The board to seed from is gone." };
      const d = this.derived(from);
      const top = Math.max(2, Math.min(128, Math.floor(Number(input.seedFrom.top) || 0) || 8));
      const ids = from.format === "roundrobin" && d.groupStandings ? qualifiers(d, from.settings.roundrobin.advance || Math.ceil(top / d.groupStandings.length)) : qualifiers(d, top);
      const names = new Map(this.effective(from).participants.map((p) => [p.id, p.name]));
      const list = ids.map((id) => names.get(id)).filter(Boolean).slice(0, top);
      if (list.length < 2) return { ok: false, status: 400, error: "That board doesn't have two placed entrants yet." };
      const fail = step({ type: "addParticipants", names: [list.join("\n")] });
      if (fail) return fail;
      if (b.format === "single" || b.format === "double") b.settings[b.format].seeding = "board";
    }
    const fail = step({ type: "rename", title: title.trim() || (src ? src.title : "New board") });
    if (fail) return fail;
    b.version = 1;
    b.createdAt = b.updatedAt = now;
    this.boards.set(b.id, b);
    await this.save(b);
    this.onChange({ before: { board: b, derived: this.derived(b) }, after: { board: b, derived: this.derived(b) }, action: { type: "create" } });
    return { ok: true, view: this.view(b) };
  }

  /** Runs one action against the board at `version`. */
  async apply(id: string, version: unknown, action: Action): Promise<ApplyOutcome> {
    const b = this.boards.get(id);
    if (!b) return { ok: false, status: 404, error: "That board is gone." };
    if (version !== b.version)
      return { ok: false, status: 409, code: "STALE", error: "Someone else just changed this board. Here's the latest; try again.", view: this.view(b) };
    const now = this.now();
    const r: ActionResult = applyAction(b, action, { now, newId: () => newId(8), random: Math.random });
    if (!r.ok) {
      const status = r.code === "REFLOW" ? 409 : r.code === "NOT_FOUND" ? 404 : 400;
      return { ok: false, status, error: r.error, code: r.code, affected: r.affected };
    }
    const next = r.board;
    next.lastChange = { at: now, type: action.type, ...(r.matchId ? { matchId: r.matchId } : {}) };
    return this.commit(b, next, { type: action.type, matchId: r.matchId, ...pidOf(action) });
  }

  /** Puts the board back as it was before its last change (this session's history). */
  async undoLast(id: string, version: unknown): Promise<ApplyOutcome> {
    const b = this.boards.get(id);
    if (!b) return { ok: false, status: 404, error: "That board is gone." };
    if (version !== b.version) return { ok: false, status: 409, code: "STALE", error: "Someone else just changed this board. Here's the latest.", view: this.view(b) };
    const stack = this.undo.get(id) ?? [];
    const prev = stack.pop();
    if (!prev) return { ok: false, status: 400, error: "Nothing to undo." };
    // Keep what isn't part of the board's play: its PIN.
    const restored: Board = { ...structuredClone(prev), pin: b.pin, version: b.version + 1, updatedAt: this.now(), lastChange: { at: this.now(), type: "undo" } };
    return this.commit(b, restored, { type: "undo" }, false);
  }

  canUndo(id: string): boolean {
    return (this.undo.get(id)?.length ?? 0) > 0;
  }

  private async commit(before: Board, after: Board, action: ChangeEvent["action"], pushUndo = true): Promise<ApplyOutcome> {
    const beforeView = { board: before, derived: this.derived(before) };
    this.boards.set(after.id, after);
    if (pushUndo) {
      const stack = this.undo.get(after.id) ?? [];
      stack.push(before);
      if (stack.length > UNDO_DEPTH) stack.shift();
      this.undo.set(after.id, stack);
    }
    await this.save(after);
    this.onChange({ before: beforeView, after: { board: after, derived: this.derived(after) }, action });
    // Season boards that sum this one change too.
    for (const s of this.boards.values()) if (s.season?.boards.includes(after.id)) this.onRefresh(s.id);
    return { ok: true, view: this.view(after) };
  }

  /** Sets (or clears, with null) the board's scorekeeper PIN. Scorer tokens are tied to the
   * PIN's random salt, so a new PIN (or none) signs every scorer out. */
  async setPin(id: string, pin: { hash: string; salt: string } | null): Promise<ApplyOutcome> {
    const b = this.boards.get(id);
    if (!b) return { ok: false, status: 404, error: "That board is gone." };
    const next: Board = { ...b, version: b.version + 1, updatedAt: this.now() };
    if (pin) next.pin = { ...pin, gen: (b.pin?.gen ?? 0) + 1 };
    else delete next.pin;
    this.boards.set(id, next);
    await this.save(next);
    this.onRefresh(id);
    return { ok: true, view: this.view(next) };
  }

  async remove(id: string): Promise<boolean> {
    if (!this.boards.delete(id)) return false;
    this.undo.delete(id);
    await (this.writes.get(id) ?? Promise.resolve());
    await rm(this.store.file(`boards/${id}.json`), { force: true });
    // Season boards that linked it just lose a column.
    this.onRemove(id);
    for (const s of this.boards.values()) if (s.season?.boards.includes(id)) this.onRefresh(s.id);
    return true;
  }

  private save(b: Board): Promise<void> {
    const prev = this.writes.get(b.id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.store.write(`boards/${b.id}.json`, b))
      .catch((err) => log.error("boards", "could not save a board", { id: b.id, err: String(err) }));
    this.writes.set(b.id, next);
    return next;
  }

  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }
}

function pidOf(a: Action): { pid?: string; value?: unknown } {
  if (a.type === "score") return { pid: a.pid, value: a.value };
  if (a.type === "attempt") return { pid: a.pid, value: a.value };
  return {};
}

export function publicBoard(eff: Board, stored: Board): PublicBoard {
  const { pin: _pin, ...rest } = eff;
  return { ...rest, hasPin: !!stored.pin };
}

function isBoard(v: unknown): v is Board {
  const b = v as Board;
  return !!b && typeof b === "object" && typeof b.id === "string" && Array.isArray(b.participants) && typeof b.format === "string" && typeof b.version === "number";
}

/** Fills in fields added after a board was saved. */
function upgrade(b: Board): Board {
  const fresh = newBoard(b.id, b.title, b.format, b.createdAt);
  return {
    ...fresh,
    ...b,
    settings: {
      points: { ...fresh.settings.points, ...b.settings?.points },
      single: { ...fresh.settings.single, ...b.settings?.single },
      double: { ...fresh.settings.double, ...b.settings?.double },
      roundrobin: { ...fresh.settings.roundrobin, ...b.settings?.roundrobin },
      ladder: { ...fresh.settings.ladder, ...b.settings?.ladder },
      best: { ...fresh.settings.best, ...b.settings?.best },
    },
    theme: { ...fresh.theme, ...b.theme, background: { ...fresh.theme.background, ...b.theme?.background } },
  };
}
