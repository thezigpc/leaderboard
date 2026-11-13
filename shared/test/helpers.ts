import { applyAction, derive, newBoard, type Action, type Board, type FormatId } from "../src/index.js";

/** A small seeded RNG (mulberry32), so random tournaments are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
export const env = (now = 1_700_000_000_000, random: () => number = Math.random) => ({ now, newId: () => `id${String(++counter).padStart(7, "0")}`, random });

/** Applies an action, failing the test on a refusal. */
export function act(b: Board, a: Action, now?: number): Board {
  const r = applyAction(b, a, env(now ?? b.updatedAt + 1000));
  if (!r.ok) throw new Error(`${a.type} refused: ${r.error}`);
  return r.board;
}

/** A board with `n` entrants named P1…Pn (seeded in that order). */
export function board(format: FormatId, n: number, settings: Record<string, unknown> = {}): Board {
  let b = newBoard("b1", "Test", format, 1_700_000_000_000);
  if (Object.keys(settings).length) b = act(b, { type: "settings", settings });
  if (n) b = act(b, { type: "addParticipants", names: [Array.from({ length: n }, (_, i) => `P${i + 1}`).join("\n")] });
  return b;
}

export const nameOf = (b: Board, id: string | undefined) => b.participants.find((p) => p.id === id)?.name;
export const idOf = (b: Board, name: string) => b.participants.find((p) => p.name === name)!.id;

/** Plays every ready match (winner picked by `pick`) until nothing is ready. Returns the board. */
export function playOut(b: Board, pick: (a: string, bb: string) => string, maxSteps = 10_000): Board {
  for (let i = 0; i < maxSteps; i++) {
    const d = derive(b);
    const m = d.matches.find((x) => x.state === "ready");
    if (!m || m.a.kind !== "player" || m.b.kind !== "player") return b;
    b = act(b, { type: "result", matchId: m.id, winner: pick(m.a.id, m.b.id) });
  }
  throw new Error("didn't finish");
}
