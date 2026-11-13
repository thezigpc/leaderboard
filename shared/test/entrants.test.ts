// Building the entrant list: pasted lists, teams and the players waiting for one, keeping
// last week's finalists apart, and the regulars from earlier boards.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apartSwap, applyAction, bracketSize, entrantLine, meetingRound, newBoard, peopleSeen, readEntrants, seedOrder, type Board } from "../src/index.js";
import { act, board, env, idOf } from "./helpers.js";

describe("reading a pasted list", () => {
  test("a header, CSV rows, Team: lines, members under 'Team:' and bulleted members", () => {
    const r = readEntrants("Team,Players\nThe Quizzards,Jo, Kim\nLes Quizérables:\n  Rosa\n  Theo\n\nBrainiacs\n- Priya\n• Sam\nAlex\n  Morgan");
    assert.equal(r.header, true);
    assert.deepEqual(
      r.entrants.map((e) => [e.name, e.members ?? [], e.line]),
      [
        ["The Quizzards", ["Jo", "Kim"], 2],
        ["Les Quizérables", ["Rosa", "Theo"], 3],
        ["Brainiacs", ["Priya", "Sam"], 7],
        ["Alex", [], 10],
        ["Morgan", [], 11],
      ],
    );
  });

  test("a line written back by entrantLine reads the same", () => {
    const e = { name: "Odd: Name", members: ["A", "B"] };
    assert.deepEqual(readEntrants(entrantLine(e)).entrants[0].members, ["A", "B"]);
    assert.equal(readEntrants(entrantLine({ name: "Solo" })).entrants[0].name, "Solo");
  });
});

describe("teams and players waiting", () => {
  const teamsBoard = (): Board => act(newBoard("t1", "Cornhole", "single", 1_700_000_000_000), { type: "entry", kind: "teams", size: 2 });

  test("arrange makes teams, keeps ids, and moves players between teams and waiting", () => {
    let b = teamsBoard();
    assert.deepEqual(b.entry, { kind: "teams", size: 2 });
    b = act(b, { type: "arrange", teams: [{ name: "Bag Ladies", members: ["Mia", "Dee"] }, { name: "Corn Stars", members: ["Jo"] }], waiting: ["Sam", "Rio"] });
    const bag = idOf(b, "Bag Ladies");
    const corn = idOf(b, "Corn Stars");
    assert.deepEqual(b.seeds, [bag, corn]);
    assert.deepEqual(b.waiting, ["Sam", "Rio"]);
    // Sam joins Corn Stars; Bag Ladies is renamed; a new team from Rio.
    b = act(b, {
      type: "arrange",
      teams: [
        { id: bag, name: "Bag Queens", members: ["Mia", "Dee"] },
        { id: corn, name: "Corn Stars", members: ["Jo", "Sam"] },
        { name: "Solo Rio", members: ["Rio"] },
      ],
      waiting: [],
    });
    assert.equal(b.participants.find((p) => p.id === bag)!.name, "Bag Queens");
    assert.deepEqual(b.participants.find((p) => p.id === corn)!.members, ["Jo", "Sam"]);
    assert.equal(b.seeds.length, 3);
    // Leaving a team out removes it before the start.
    b = act(b, { type: "arrange", teams: [{ id: bag, name: "Bag Queens", members: ["Mia", "Dee"] }], waiting: ["Jo", "Sam", "Rio"] });
    assert.deepEqual(b.seeds, [bag]);
  });

  test("refuses duplicates and dropping teams once a bracket has started", () => {
    let b = teamsBoard();
    const twice = applyAction(b, { type: "arrange", teams: [{ name: "A", members: ["Mia"] }], waiting: ["mia"] }, env());
    assert.equal(twice.ok, false);
    const sameName = applyAction(b, { type: "arrange", teams: [{ name: "A", members: [] }, { name: "a", members: [] }], waiting: [] }, env());
    assert.equal(sameName.ok, false);
    b = act(b, { type: "arrange", teams: [{ name: "A", members: ["x"] }, { name: "B", members: ["y"] }], waiting: [] });
    b = act(b, { type: "start" });
    const a = idOf(b, "A");
    const bb = idOf(b, "B");
    assert.equal(applyAction(b, { type: "arrange", teams: [{ id: a, name: "A", members: ["x"] }], waiting: [] }, env()).ok, false);
    assert.equal(applyAction(b, { type: "arrange", teams: [{ id: a, name: "A", members: ["x"] }, { id: bb, name: "B", members: ["y"] }, { name: "C", members: [] }], waiting: [] }, env()).ok, false);
    // Members can still change (a sub comes in).
    b = act(b, { type: "arrange", teams: [{ id: a, name: "A", members: ["x", "z"] }, { id: bb, name: "B", members: ["y"] }], waiting: [] });
    assert.deepEqual(b.participants[0].members, ["x", "z"]);
  });

  test("adding a team takes its members off the waiting list", () => {
    let b = teamsBoard();
    b = act(b, { type: "arrange", teams: [], waiting: ["Mia", "Dee", "Jo"] });
    b = act(b, { type: "addParticipants", names: ["Bag Ladies: Mia, Dee"] });
    assert.deepEqual(b.waiting, ["Jo"]);
  });
});

describe("keeping last week's finalists apart", () => {
  test("meetingRound matches the bracket's halves", () => {
    for (const n of [4, 5, 8, 12, 16, 33]) {
      const size = bracketSize(n);
      const rounds = Math.log2(size);
      // Seeds 1 and 2 only meet in the final.
      assert.equal(meetingRound(n, 1, 2), rounds);
      // A seed's first opponent is the matching weakest seed.
      assert.equal(meetingRound(n, 1, size), 1);
    }
  });

  test("apartSwap moves the second finalist into the other half, never onto a bye", () => {
    for (let n = 3; n <= 40; n++) {
      const size = bracketSize(n);
      const rounds = Math.log2(size);
      for (let a = 1; a <= n; a++)
        for (let b = 1; b <= n; b++) {
          if (a === b) continue;
          const s = apartSwap(n, a, b);
          if (meetingRound(n, a, b) === rounds) {
            assert.equal(s, null);
            continue;
          }
          if (rounds < 2) continue;
          assert.ok(s !== null && s <= n && s !== a && s !== b, `n=${n} a=${a} b=${b}`);
          // After the swap b sits where s was: in the other half from a.
          const order = seedOrder(size);
          const half = (x: number) => (order.indexOf(x) < size / 2 ? 0 : 1);
          assert.notEqual(half(s!), half(a));
        }
    }
  });
});

describe("regulars", () => {
  test("players and teams from earlier boards, latest first, with drafts and the current board left out", () => {
    let one = board("single", 0);
    one = { ...act(one, { type: "addParticipants", names: ["Bag Ladies: Mia, Dee\nCorn Stars: Jo, Kim"] }), id: "one", startedAt: 1000, status: "finished", winners: ["Bag Ladies"] };
    let two = board("points", 0);
    two = { ...act(two, { type: "addParticipants", names: ["Mia\nTheo"] }), id: "two", startedAt: 2000, status: "live" };
    const draft = { ...board("single", 2), id: "draft" };
    const seen = peopleSeen([one, two, draft]);
    assert.deepEqual(
      seen.players.map((p) => [p.name, p.times]),
      [
        ["Mia", 2],
        ["Theo", 1],
        ["Dee", 1],
        ["Jo", 1],
        ["Kim", 1],
      ],
    );
    assert.deepEqual(seen.teams.map((t) => [t.name, t.members, t.won]), [
      ["Bag Ladies", ["Mia", "Dee"], 1],
      ["Corn Stars", ["Jo", "Kim"], 0],
    ]);
    assert.equal(peopleSeen([one, two], "two").players.length, 4);
  });
});
