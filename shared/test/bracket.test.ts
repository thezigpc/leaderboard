import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, buildPlan, derive, seedOrder, type Board, type DerivedMatch } from "../src/index.js";
import { act, board, env, idOf, nameOf, playOut, rng } from "./helpers.js";

/** Checks that hold at every moment of any bracket. */
function invariants(b: Board) {
  const d = derive(b);
  const busy = new Map<string, string>();
  for (const m of d.matches) {
    if (m.state !== "ready") continue;
    for (const s of [m.a, m.b]) {
      assert.equal(s.kind, "player", `${m.id} is ready with a missing side`);
      if (s.kind !== "player") continue;
      assert.ok(!busy.has(s.id), `${nameOf(b, s.id)} is in two ready matches (${busy.get(s.id)} and ${m.id})`);
      busy.set(s.id, m.id);
    }
    assert.notEqual((m.a as { id: string }).id, (m.b as { id: string }).id, `${m.id}: a player against themselves`);
  }
}

function lossesBy(d: ReturnType<typeof derive>): Map<string, number> {
  const losses = new Map<string, number>();
  for (const m of d.matches) if (m.state === "done") losses.set(m.loser!, (losses.get(m.loser!) ?? 0) + 1);
  return losses;
}

/** Plays a bracket to the end with random winners, checking invariants after every result. */
function playRandom(b: Board, seed: number): Board {
  const r = rng(seed);
  for (let step = 0; step < 1000; step++) {
    invariants(b);
    const ready = derive(b).matches.filter((m) => m.state === "ready");
    if (!ready.length) return b;
    // Play them in a random order, like lanes finishing at different times.
    const m = ready[Math.floor(r() * ready.length)] as DerivedMatch & { a: { id: string }; b: { id: string } };
    b = act(b, { type: "result", matchId: m.id, winner: r() < 0.5 ? m.a.id : m.b.id });
  }
  throw new Error("bracket never finished");
}

describe("seeding", () => {
  test("standard seed order", () => {
    assert.deepEqual(seedOrder(2), [1, 2]);
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    for (const size of [16, 32, 64, 128]) {
      const o = seedOrder(size);
      assert.deepEqual([...o].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
      // First-round pairs add up to size + 1.
      for (let i = 0; i < size; i += 2) assert.equal(o[i] + o[i + 1], size + 1);
    }
  });

  test("byes go to the top seeds and never meet each other", () => {
    for (let n = 3; n <= 64; n++) {
      const b = act(board("single", n), { type: "start" });
      const d = derive(b);
      const r1 = d.matches.filter((m) => m.section === "W" && m.round === 1);
      const byes = r1.filter((m) => m.state === "bye");
      const size = r1.length * 2;
      assert.equal(byes.length, size - n, `n=${n}`);
      for (const m of byes) assert.ok(m.a.kind === "player" || m.b.kind === "player", `n=${n}: two byes met`);
      const byeSeeds = byes.map((m) => Number(nameOf(b, m.winner)!.slice(1))).sort((a, b) => a - b);
      assert.deepEqual(byeSeeds, Array.from({ length: size - n }, (_, i) => i + 1), `n=${n}`);
    }
  });
});

describe("single elimination", () => {
  test("every size 2 to 128 finishes with n-1 matches and sensible places", () => {
    for (let n = 2; n <= 128; n += n < 40 ? 1 : 7) {
      for (const thirdPlace of [false, true]) {
        let b = act(board("single", n, { single: { thirdPlace } }), { type: "start" });
        b = playRandom(b, n * 31 + (thirdPlace ? 1 : 0));
        const d = derive(b);
        assert.ok(d.complete, `n=${n} not complete`);
        const played = d.matches.filter((m) => m.state === "done");
        const third = d.matches.find((m) => m.id === "3P");
        const extra = third?.state === "done" ? 1 : 0;
        assert.equal(played.length, n - 1 + extra, `n=${n} third=${thirdPlace}`);
        const losses = lossesBy(d);
        for (const p of b.participants) {
          const l = losses.get(p.id) ?? 0;
          if (p.id === d.champion) assert.equal(l, 0);
          else assert.ok(l === 1 || (l === 2 && extra === 1), `n=${n}: ${p.name} lost ${l} times`);
        }
        const places = new Map(d.standings.map((r) => [r.id, r.place]));
        assert.equal(places.get(d.champion!), 1);
        assert.equal(d.standings.filter((r) => r.place === 1).length, 1);
        if (n >= 2) assert.equal(d.standings.filter((r) => r.place === 2).length, 1, `n=${n}`);
        if (thirdPlace && n >= 4) assert.equal(d.standings.filter((r) => r.place === 3).length, 1, `n=${n} one 3rd`);
        if (!thirdPlace && n >= 4) assert.equal(d.standings.filter((r) => r.place === 3).length, 2, `n=${n} two 3rds`);
        for (const r of d.standings) assert.ok(r.place >= 1, `n=${n}: ${r.name} has no place`);
      }
    }
  });

  test("the favourite wins when the better seed always wins", () => {
    const b = playOut(act(board("single", 13), { type: "start" }), (a, bb) => (a < bb ? a : bb));
    // ids are made in seed order, so the smaller id is the better seed.
    assert.equal(nameOf(b, derive(b).champion), "P1");
  });

  test("third place with three entrants goes to the semifinal loser", () => {
    let b = act(board("single", 3, { single: { thirdPlace: true } }), { type: "start" });
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    const d = derive(b);
    assert.ok(d.complete);
    assert.deepEqual(
      d.standings.map((r) => [r.name, r.place]),
      [
        ["P1", 1],
        ["P2", 2],
        ["P3", 3],
      ],
    );
  });
});

describe("double elimination", () => {
  for (const bracketReset of [true, false]) {
    test(`every size 2 to 64 (reset ${bracketReset ? "on" : "off"}): everyone but the champion loses twice`, () => {
      for (let n = 2; n <= 64; n++) {
        for (const seed of [1, 2, 3]) {
          let b = act(board("double", n, { double: { bracketReset } }), { type: "start" });
          b = playRandom(b, n * 1000 + seed);
          const d = derive(b);
          assert.ok(d.complete, `n=${n} seed=${seed}: not complete`);
          const losses = lossesBy(d);
          const champ = d.champion!;
          assert.ok(champ, `n=${n}: no champion`);
          assert.ok((losses.get(champ) ?? 0) <= 1, `n=${n}: the champion lost twice`);
          const gf = d.matches.find((m) => m.id === "GF")!;
          const wbChamp = gf.a.kind === "player" ? gf.a.id : undefined;
          for (const p of b.participants) {
            if (p.id === champ) continue;
            const l = losses.get(p.id) ?? 0;
            // Without a reset, the winners-bracket champion can be out after one loss (the grand final).
            const allowed = !bracketReset && p.id === wbChamp ? [1] : [2];
            assert.ok(allowed.includes(l), `n=${n} seed=${seed}: ${p.name} lost ${l} times`);
          }
          const played = d.matches.filter((m) => m.state === "done").length;
          if (bracketReset) assert.ok(played === 2 * n - 2 || played === 2 * n - 1, `n=${n}: ${played} matches`);
          else assert.equal(played, 2 * n - 2, `n=${n}`);
          // Places: one 1st, one 2nd, one 3rd (from 3 entrants), everyone placed.
          const count = (p: number) => d.standings.filter((r) => r.place === p).length;
          assert.equal(count(1), 1, `n=${n}`);
          assert.equal(count(2), 1, `n=${n}`);
          if (n >= 3) assert.equal(count(3), 1, `n=${n}`);
          for (const r of d.standings) assert.ok(r.place >= 1, `n=${n}: ${r.name} has no place`);
        }
      }
    });
  }

  test("losers drop into the right round: a winners-round-r loser plays next in losers round 2(r-1)", () => {
    for (const size of [4, 8, 16, 32, 64]) {
      const plan = buildPlan("double", size, { bracketReset: true });
      const byId = new Map(plan.matches.map((m) => [m.id, m]));
      const drops = new Map<number, number>();
      for (const m of plan.matches.filter((x) => x.section === "W")) {
        const to = byId.get(m.loserTo!)!;
        if (m.round === plan.rounds) assert.equal(to.section, "L");
        assert.equal(to.round, m.round === 1 ? 1 : 2 * (m.round - 1), `${size}: ${m.id} → ${to.id}`);
        drops.set(m.round, (drops.get(m.round) ?? 0) + 1);
      }
      // Every losers match takes at most one dropped player per slot, and each slot is used once.
      const fed = new Map<string, number>();
      for (const m of plan.matches.filter((x) => x.section === "W")) fed.set(m.loserTo!, (fed.get(m.loserTo!) ?? 0) + 1);
      for (const [id, c] of fed) assert.ok(c <= 2 && (c === 1 || id.startsWith("L1.")), `${size}: ${id} fed ${c}`);
      assert.equal(plan.lRounds, 2 * (plan.rounds - 1));
    }
  });

  test("the first players to drop don't meet the one who just beat them (8 and 16)", () => {
    for (const n of [8, 16]) {
      let b = act(board("double", n), { type: "start" });
      // Better seed always wins the winners bracket.
      b = playOut(b, (a, bb) => (a < bb ? a : bb));
      const d = derive(b);
      const beatenBy = new Map<string, string>();
      for (const m of d.matches.filter((x) => x.section === "W" && x.state === "done")) beatenBy.set(m.loser!, m.winner!);
      for (const m of d.matches.filter((x) => x.section === "L" && x.state === "done" && x.round === 2)) {
        const [a, c] = [m.result!.a, m.result!.b];
        assert.notEqual(beatenBy.get(a), c, `n=${n}: ${nameOf(b, a)} meets ${nameOf(b, c)} again in ${m.id}`);
        assert.notEqual(beatenBy.get(c), a, `n=${n}: ${nameOf(b, c)} meets ${nameOf(b, a)} again in ${m.id}`);
      }
    }
  });

  test("the reset is played only when the losers-bracket champion wins the grand final", () => {
    const toGF = (b: Board) => {
      for (;;) {
        const m = derive(b).matches.find((x) => x.state === "ready" && x.id !== "GF");
        if (!m || m.a.kind !== "player" || m.b.kind !== "player") return b;
        b = act(b, { type: "result", matchId: m.id, winner: m.a.id < m.b.id ? m.a.id : m.b.id });
      }
    };
    let b = toGF(act(board("double", 4), { type: "start" }));
    const gf = derive(b).matches.find((m) => m.id === "GF")!;
    assert.equal(gf.state, "ready");
    const [wb, lb] = [(gf.a as { id: string }).id, (gf.b as { id: string }).id];
    // The winners-bracket champion wins: done, no reset.
    const won = act(b, { type: "result", matchId: "GF", winner: wb });
    assert.equal(derive(won).matches.find((m) => m.id === "GF2")!.state, "skipped");
    assert.equal(derive(won).champion, wb);
    // The losers-bracket champion wins: the reset is on.
    const lost = act(b, { type: "result", matchId: "GF", winner: lb });
    assert.equal(derive(lost).matches.find((m) => m.id === "GF2")!.state, "ready");
    assert.equal(derive(lost).champion, undefined);
    const reset = act(lost, { type: "result", matchId: "GF2", winner: lb });
    assert.equal(derive(reset).champion, lb);
    assert.ok(derive(reset).complete);
    // With the reset off, the grand final decides it.
    const noReset = act(b, { type: "settings", settings: { double: { bracketReset: false } } });
    const done = act(noReset, { type: "result", matchId: "GF", winner: lb });
    assert.equal(derive(done).champion, lb);
    assert.ok(derive(done).complete);
  });
});

describe("editing and re-flow", () => {
  test("changing an early result warns, then clears what was built on it", () => {
    let b = act(board("single", 8), { type: "start" });
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    const d = derive(b);
    const r1 = d.matches.find((m) => m.id === "W1.0")!;
    const r = applyAction(b, { type: "result", matchId: "W1.0", winner: r1.loser! }, env());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "REFLOW");
    assert.deepEqual(!r.ok && r.affected, ["Semifinal", "Final"]);
    const forced = act(b, { type: "result", matchId: "W1.0", winner: r1.loser!, force: true });
    const fd = derive(forced);
    assert.equal(fd.matches.find((m) => m.id === "W2.0")!.state, "ready");
    assert.equal(fd.matches.find((m) => m.id === "W3.0")!.state, "waiting");
    assert.equal(fd.champion, undefined);
    // The other semifinal is untouched.
    assert.equal(fd.matches.find((m) => m.id === "W2.1")!.state, "done");
  });

  test("changing only the score doesn't clear anything", () => {
    let b = act(board("single", 4), { type: "start" });
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    const w = derive(b).matches.find((m) => m.id === "W1.0")!.winner!;
    const after = act(b, { type: "result", matchId: "W1.0", winner: w, scoreA: 3, scoreB: 1 });
    assert.ok(derive(after).complete);
  });

  test("clearing a result re-flows the same way", () => {
    let b = act(board("double", 6), { type: "start" });
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    const r = applyAction(b, { type: "clearResult", matchId: "W1.1" }, env());
    assert.equal(!r.ok && r.code, "REFLOW");
    const cleared = act(b, { type: "clearResult", matchId: "W1.1", force: true });
    assert.equal(derive(cleared).matches.find((m) => m.id === "W1.1")!.state, "ready");
    assert.ok(!derive(cleared).complete);
  });

  test("a stale result for players who no longer meet is never shown", () => {
    let b = act(board("single", 4), { type: "start" });
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    // Simulate an old result left behind (it shouldn't be, but derive must ignore it).
    const bogus = structuredClone(b);
    bogus.results["W2.0"] = { ...bogus.results["W2.0"], a: "nobody", b: "else", winner: "nobody" };
    assert.equal(derive(bogus).matches.find((m) => m.id === "W2.0")!.state, "ready");
  });
});

describe("no-shows", () => {
  test("a withdrawn player's next match is a walkover and they leave the bracket entirely", () => {
    let b = act(board("double", 6), { type: "start" });
    const p6 = idOf(b, "P6");
    b = act(b, { type: "removeParticipant", id: p6 });
    assert.ok(b.participants.find((p) => p.id === p6)!.withdrawn, "withdrawn, not deleted");
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    const d = derive(b);
    assert.ok(d.complete);
    for (const m of d.matches.filter((x) => x.state === "done")) assert.ok(m.result!.a !== p6 && m.result!.b !== p6);
    assert.equal(nameOf(b, d.champion), "P1");
  });

  test("withdrawing mid-bracket keeps what they played", () => {
    let b = act(board("single", 8), { type: "start" });
    const r1 = derive(b).matches.find((m) => m.id === "W1.0")!;
    b = act(b, { type: "result", matchId: "W1.0", winner: (r1.a as { id: string }).id });
    b = act(b, { type: "removeParticipant", id: (r1.a as { id: string }).id });
    const d = derive(b);
    assert.equal(d.matches.find((m) => m.id === "W1.0")!.state, "done");
    b = playOut(b, (a, bb) => (a < bb ? a : bb));
    assert.ok(derive(b).complete);
  });

  test("before the start, removing someone deletes them", () => {
    let b = board("single", 5);
    b = act(b, { type: "removeParticipant", id: idOf(b, "P3") });
    assert.equal(b.participants.length, 4);
    assert.ok(!b.seeds.includes("P3"));
  });
});

describe("lanes", () => {
  test("called matches come first in up next, in call order", () => {
    let b = act(board("single", 8), { type: "start" });
    b = act(b, { type: "lanes", lanes: ["Board 1", "Board 2"] });
    b = act(b, { type: "lane", matchId: "W1.3", lane: "Board 2" }, 2_000_000_000_000);
    b = act(b, { type: "lane", matchId: "W1.1", lane: "Board 1" }, 2_000_000_001_000);
    const d = derive(b);
    assert.deepEqual(d.upNext.map((m) => m.id), ["W1.3", "W1.1", "W1.0", "W1.2"]);
    assert.equal(d.upNext[0].lane, "Board 2");
    // A result takes it out of the queue; the lane stays on record.
    const w = d.upNext[0].a as { id: string };
    const after = derive(act(b, { type: "result", matchId: "W1.3", winner: w.id }));
    assert.equal(after.upNext[0].id, "W1.1");
  });

  test("removing a lane clears it from matches", () => {
    let b = act(board("single", 4), { type: "start" });
    b = act(b, { type: "lanes", lanes: ["Table 1"] });
    b = act(b, { type: "lane", matchId: "W1.0", lane: "Table 1" });
    b = act(b, { type: "lanes", lanes: [] });
    assert.equal(derive(b).matches.find((m) => m.id === "W1.0")!.lane, undefined);
  });
});

describe("results", () => {
  test("scores pick the winner, and a lower winner score is refused", () => {
    let b = act(board("single", 2, { single: { bestOf: 3 } }), { type: "start" });
    const m = derive(b).matches[0];
    const [a, c] = [(m.a as { id: string }).id, (m.b as { id: string }).id];
    const bad = applyAction(b, { type: "result", matchId: m.id, winner: a, scoreA: 1, scoreB: 2 }, env());
    assert.equal(bad.ok, false);
    const tie = applyAction(b, { type: "result", matchId: m.id, winner: null, scoreA: 1, scoreB: 1 }, env());
    assert.equal(tie.ok, false);
    b = act(b, { type: "result", matchId: m.id, winner: undefined as unknown as null, scoreA: 1, scoreB: 2 });
    assert.equal(derive(b).champion, c);
    assert.equal(b.settings.single.bestOf, 3);
  });

  test("a walkover can be recorded", () => {
    let b = act(board("single", 2), { type: "start" });
    const m = derive(b).matches[0];
    b = act(b, { type: "result", matchId: m.id, winner: (m.b as { id: string }).id, forfeit: true });
    assert.equal(derive(b).matches[0].result!.forfeit, true);
  });

  test("a match still waiting for players can't be scored", () => {
    const b = act(board("single", 4), { type: "start" });
    const r = applyAction(b, { type: "result", matchId: "W2.0", winner: "x" }, env());
    assert.equal(!r.ok && r.code, "STATE");
  });

  test("brackets can't be scored before they start, nor after they finish", () => {
    const b = board("single", 4);
    assert.equal(applyAction(b, { type: "result", matchId: "W1.0", winner: "x" }, env()).ok, false);
    const f = act(act(b, { type: "start" }), { type: "finish" });
    assert.equal(applyAction(f, { type: "result", matchId: "W1.0", winner: "x" }, env()).ok, false);
  });
});
