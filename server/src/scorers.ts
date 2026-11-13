// Per-board scorekeeper PINs, for a trivia host or a league captain who isn't staff.
//
// The PIN is stored as a salted scrypt hash on the board. Typing it in gets a signed token
// for that one board (HMAC with a secret kept in DATA_DIR/secret.json), which the phone keeps
// and sends with each change. The token is tied to the PIN's salt, so setting a new PIN or
// clearing it signs every scorer of that board out. Wrong guesses are limited per device and
// per board.

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { JsonStore } from "@bargames/gamekit/server";
import { LIMITS, type Board } from "@leaderboard/shared";

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const PER_DEVICE = 6;
const PER_BOARD = 30;

export const validPin = (pin: unknown): pin is string =>
  typeof pin === "string" && pin.length >= LIMITS.pinMin && pin.length <= LIMITS.pinMax && /^\d+$/.test(pin);

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  return { hash: (await scryptAsync(pin, salt, 32)).toString("hex"), salt };
}

async function pinMatches(pin: string, stored: { hash: string; salt: string }): Promise<boolean> {
  const got = await scryptAsync(pin, stored.salt, 32);
  const want = Buffer.from(stored.hash, "hex");
  return want.length === got.length && timingSafeEqual(got, want);
}

export class Scorers {
  private secret = "";
  private fails = new Map<string, number[]>();

  constructor(
    private store: JsonStore,
    private now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    const s = await this.store.read<{ secret: string }>("secret.json", (v): v is { secret: string } => typeof (v as { secret?: unknown })?.secret === "string");
    if (s && s.secret.length >= 32) this.secret = s.secret;
    else {
      this.secret = randomBytes(32).toString("hex");
      await this.store.write("secret.json", { secret: this.secret });
    }
  }

  private sign(boardId: string, salt: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${boardId}.${salt}.${exp}`).digest("base64url");
  }

  issue(board: Board): string {
    const exp = this.now() + TOKEN_TTL_MS;
    return `${board.id}.${exp}.${this.sign(board.id, board.pin!.salt, exp)}`;
  }

  /** The board id a token is good for right now, if any. */
  verify(token: string, boardOf: (id: string) => Board | undefined): string | undefined {
    const [id, expS, sig] = token.split(".");
    const exp = Number(expS);
    if (!id || !sig || !Number.isFinite(exp) || exp < this.now()) return undefined;
    const b = boardOf(id);
    if (!b?.pin) return undefined;
    const want = Buffer.from(this.sign(id, b.pin.salt, exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got) ? id : undefined;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const list = (this.fails.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  /** Checks a PIN, counting wrong guesses. */
  async login(board: Board, pin: unknown, ip: string): Promise<{ ok: true; token: string } | { ok: false; status: number; error: string }> {
    if (!board.pin) return { ok: false, status: 400, error: "This board has no scorekeeper PIN. Ask staff to set one." };
    const devKey = `${board.id}|${ip}`;
    if (this.recent(devKey).length >= PER_DEVICE || this.recent(board.id).length >= PER_BOARD)
      return { ok: false, status: 429, error: "Too many wrong PINs. Wait ten minutes, or ask staff." };
    if (validPin(pin) && (await pinMatches(pin, board.pin))) return { ok: true, token: this.issue(board) };
    for (const k of [devKey, board.id]) this.fails.set(k, [...this.recent(k), this.now()]);
    return { ok: false, status: 401, error: "That PIN isn't right." };
  }
}
