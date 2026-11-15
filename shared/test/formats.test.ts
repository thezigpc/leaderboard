import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  boardCsv,
  circleSchedule,
  derive,
  ladderTargets,
  makeGroups,
  mergeTheme,
  newBoard,
  parseEntrants,
  presetTheme,
  qualifiers,
  rankIds,
  withSeason,
  hasSeason,
  readNight,
  similarNames,
  type Board,
} from "../src/index.js";
import { act, board, env, idOf, nameOf } from "./helpers.js";

const places = (b: Board) => Object.fromEntries(derive(b).standings.map((r) => [r.name, r.place]));

describe("ranking", () => {
  test("ties share a place and the next place skips", () => {
    const p = rankIds(["a", "b", "c", "d"], new Map([["a", 5], ["b", 3], ["c", 3], ["d", 1]]), []);
    assert.deepEqual(Object.fromEntries(p), { a: 1, b: 2, c: 2, d: 4 });
  });
  test("tiebreakers apply within the tied group only, in order", () => {
    const p = rankIds(
      ["a", "b", "c"],
      new Map([["a", 3], ["b", 3], ["c", 3]]),
      [(g) => new Map(g.map((id) => [id, id === "c" ? 9 : 1])), (g) => new Map(g.map((id) => [id, id === "b" ? 2 : 1]))],
    );
    assert.deepEqual(Object.fromEntries(p), { c: 1, b: 2, a: 3 });
  });
});

describe("points table (rounds)", () => {
  test("totals rank high to low, with the last round breaking ties", () => {
    let b = act(board("points", 4), { type: "start" });
    const s = (name: string, r: string, v: number) => (b = act(b, { type: "score", pid: idOf(b, name), roundId: r, value: v }));
    s("P1", "r1", 5);
    s("P1", "r2", 3);
    s("P2", "r1", 3);
    s("P2", "r2", 5);
    s("P3", "r1", 8);
    s("P4", "r1", 1);
    // P1 and P2 tie on 8 with P3; P2 had the best last round (r2: 5).
    assert.deepEqual(places(b), { P2: 1, P1: 2, P3: 3, P4: 4 });
    const d = derive(b);
    assert.equal(d.standings[0].value, 8);
    assert.equal(d.standings[0].cells.r2, 5);
    assert.equal(d.champion, idOf(b, "P2"));
  });

  test("low scores can win (golf-style), and identical rows share", () => {
    let b = board("points", 3, { points: { order: "low", tiebreaks: [] } });
    for (const [n, v] of [["P1", 4], ["P2", 2], ["P3", 4]] as const) b = act(b, { type: "score", pid: idOf(b, n), roundId: "r1", value: v });
    assert.deepEqual(places(b), { P2: 1, P1: 2, P3: 2 });
  });

  test("nobody has a place until a score is in; clearing a score works", () => {
    let b = board("points", 2);
    assert.deepEqual(places(b), { P1: 0, P2: 0 });
    b = act(b, { type: "score", pid: idOf(b, "P1"), roundId: "r1", value: 2.5 });
    assert.equal(derive(b).standings[0].value, 2.5);
    b = act(b, { type: "score", pid: idOf(b, "P1"), roundId: "r1", value: null });
    assert.deepEqual(b.scores, {});
  });

  test("rounds can be renamed and added while live; late teams join", () => {
    let b = act(board("points", 2), { type: "start" });
    b = act(b, { type: "settings", settings: { points: { rounds: [{ id: "r1", name: "Music" }, { id: "bonus", name: "Bonus" }] } } });
    assert.deepEqual(derive(b).columns.map((c) => c.label), ["Music", "Bonus"]);
    b = act(b, { type: "addParticipants", names: ["Late Team"] });
    assert.equal(b.participants.length, 3);
  });

  test("bad input is refused", () => {
    const b = board("points", 1);
    assert.equal(applyAction(b, { type: "score", pid: idOf(b, "P1"), roundId: "nope", value: 1 }, env()).ok, false);
    assert.equal(applyAction(b, { type: "score", pid: idOf(b, "P1"), roundId: "r1", value: "abc" as unknown as number }, env()).ok, false);
    assert.equal(applyAction(b, { type: "score", pid: "ghost", roundId: "r1", value: 1 }, env()).ok, false);
  });
});

describe("league table (points, matches)", () => {
  const league = () => act(board("points", 4, { points: { scoring: "matches" } }), { type: "start" });
  const play = (b: Board, a: string, c: string, winner: string | null, sa?: number, sb?: number) => {
    b = act(b, { type: "leagueMatch", a: idOf(b, a), b: idOf(b, c) });
    const id = b.leagueMatches.at(-1)!.id;
    return act(b, { type: "result", matchId: id, winner: winner && idOf(b, winner), scoreA: sa, scoreB: sb });
  };

  test("3 for a win, 1 for a draw; head-to-head breaks a tie", () => {
    let b = league();
    b = play(b, "P1", "P2", "P2");
    b = play(b, "P1", "P3", "P1");
    b = play(b, "P2", "P4", "P4");
    b = play(b, "P3", "P4", null);
    // P1 3, P2 3, P4 4, P3 1. P2 beat P1 head to head.
    assert.deepEqual(places(b), { P4: 1, P2: 2, P1: 3, P3: 4 });
    const d = derive(b);
    assert.deepEqual(d.standings.find((r) => r.name === "P4")!.cells, { p: 2, w: 1, d: 1, l: 0, diff: 0 });
  });

  test("score difference when head-to-head can't separate", () => {
    let b = league();
    b = act(b, { type: "settings", settings: { points: { leagueTiebreaks: ["headToHead", "diff"] } } });
    b = play(b, "P1", "P3", "P1", 10, 2);
    b = play(b, "P2", "P4", "P2", 6, 5);
    assert.deepEqual(places(b), { P1: 1, P2: 2, P4: 3, P3: 4 });
  });

  test("a pending match is up next; removing it works", () => {
    let b = league();
    b = act(b, { type: "leagueMatch", a: idOf(b, "P1"), b: idOf(b, "P2") });
    assert.equal(derive(b).upNext.length, 1);
    b = act(b, { type: "removeLeagueMatch", id: b.leagueMatches[0].id });
    assert.equal(derive(b).upNext.length, 0);
  });
});

describe("round robin", () => {
  test("the circle method: each pair once, nobody twice in a round", () => {
    for (let n = 2; n <= 16; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const rounds = circleSchedule(ids);
      assert.equal(rounds.length, n % 2 ? n : n - 1);
      const pairs = new Set<string>();
      for (const r of rounds) {
        const seen = new Set<string>();
        for (const [a, b] of r) {
          assert.ok(!seen.has(a) && !seen.has(b), `n=${n}: someone plays twice in a round`);
          seen.add(a);
          seen.add(b);
          const key = [a, b].sort().join("-");
          assert.ok(!pairs.has(key), `n=${n}: ${key} twice`);
          pairs.add(key);
        }
      }
      assert.equal(pairs.size, (n * (n - 1)) / 2);
    }
  });

  test("snake groups are even", () => {
    assert.deepEqual(makeGroups(["1", "2", "3", "4", "5", "6", "7", "8"], 2), [
      ["1", "4", "5", "8"],
      ["2", "3", "6", "7"],
    ]);
    assert.deepEqual(makeGroups(["1", "2", "3"], 4).length, 1);
  });

  test("groups play inside themselves; two legs double the matches; it completes", () => {
    let b = act(board("roundrobin", 8, { roundrobin: { groups: 2, legs: 2 } }), { type: "start" });
    const d0 = derive(b);
    assert.equal(d0.matches.length, 2 * 2 * 6);
    for (const m of d0.matches) {
      const g = b.groups![m.group!];
      assert.ok(g.includes((m.a as { id: string }).id) && g.includes((m.b as { id: string }).id));
    }
    for (const m of d0.matches) b = act(b, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id < (m.b as { id: string }).id ? (m.a as { id: string }).id : (m.b as { id: string }).id });
    const d = derive(b);
    assert.ok(d.complete);
    assert.equal(d.groupStandings!.length, 2);
    // Top two of each group, A1 B1 A2 B2.
    assert.deepEqual(qualifiers(d, 2).map((id) => nameOf(b, id)), ["P1", "P2", "P4", "P3"]);
  });

  test("draws only when allowed; groups and legs lock once started", () => {
    let b = act(board("roundrobin", 3), { type: "start" });
    const m = derive(b).matches[0];
    assert.equal(applyAction(b, { type: "result", matchId: m.id, winner: null }, env()).ok, false);
    b = act(b, { type: "settings", settings: { roundrobin: { allowDraws: true } } });
    b = act(b, { type: "result", matchId: m.id, winner: null, scoreA: 1, scoreB: 1 });
    assert.equal(derive(b).standings.filter((r) => r.cells.d === 1).length, 2);
    assert.equal(applyAction(b, { type: "settings", settings: { roundrobin: { groups: 2 } } }, env()).ok, false);
    assert.equal(applyAction(b, { type: "addParticipants", names: ["Late"] }, env()).ok, false);
  });

  test("a withdrawn player's unplayed matches are skipped and it can still complete", () => {
    let b = act(board("roundrobin", 4), { type: "start" });
    b = act(b, { type: "removeParticipant", id: idOf(b, "P4") });
    for (const m of derive(b).matches.filter((x) => x.state === "ready")) b = act(b, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id });
    assert.ok(derive(b).complete);
  });
});

describe("ladder", () => {
  test("beating someone above takes their place; the rest move down", () => {
    let b = act(board("ladder", 5, { ladder: { reach: 0 } }), { type: "start" });
    b = act(b, { type: "challenge", challenger: idOf(b, "P5"), defender: idOf(b, "P2") });
    const c = b.challenges[0];
    assert.equal(derive(b).upNext[0].id, c.id);
    b = act(b, { type: "result", matchId: c.id, winner: c.challenger });
    assert.deepEqual(derive(b).standings.map((r) => r.name), ["P1", "P5", "P2", "P3", "P4"]);
    // A defender who wins stays put.
    b = act(b, { type: "challenge", challenger: idOf(b, "P3"), defender: idOf(b, "P1") });
    b = act(b, { type: "result", matchId: b.challenges[1].id, winner: idOf(b, "P1") });
    assert.deepEqual(derive(b).standings.map((r) => r.name), ["P1", "P5", "P2", "P3", "P4"]);
  });

  test("reach limits who can be challenged, and one challenge at a time each", () => {
    let b = act(board("ladder", 6, { ladder: { reach: 2 } }), { type: "start" });
    assert.deepEqual(ladderTargets(b, idOf(b, "P6")).map((id) => nameOf(b, id)), ["P4", "P5"]);
    assert.equal(applyAction(b, { type: "challenge", challenger: idOf(b, "P6"), defender: idOf(b, "P1") }, env()).ok, false);
    assert.equal(applyAction(b, { type: "challenge", challenger: idOf(b, "P1"), defender: idOf(b, "P6") }, env()).ok, false);
    b = act(b, { type: "challenge", challenger: idOf(b, "P6"), defender: idOf(b, "P5") });
    assert.deepEqual(ladderTargets(b, idOf(b, "P4")).map((id) => nameOf(b, id)), ["P2", "P3"]);
    assert.equal(applyAction(b, { type: "challenge", challenger: idOf(b, "P6"), defender: idOf(b, "P4") }, env()).ok, false);
  });

  test("editing an old challenge re-derives the ladder; late joiners start at the bottom", () => {
    let b = act(board("ladder", 3, { ladder: { reach: 0 } }), { type: "start" });
    b = act(b, { type: "challenge", challenger: idOf(b, "P3"), defender: idOf(b, "P1") });
    const id = b.challenges[0].id;
    b = act(b, { type: "result", matchId: id, winner: idOf(b, "P3") });
    assert.equal(derive(b).standings[0].name, "P3");
    b = act(b, { type: "result", matchId: id, winner: idOf(b, "P1") });
    assert.equal(derive(b).standings[0].name, "P1");
    b = act(b, { type: "addParticipants", names: ["New"] });
    assert.equal(derive(b).standings.at(-1)!.name, "New");
  });
});

describe("best score / time", () => {
  test("best attempt counts; lowest time wins; second best breaks a tie", () => {
    let b = act(board("best", 3, { best: { order: "low", unit: "time" } }), { type: "start" });
    const t = (n: string, v: number) => (b = act(b, { type: "attempt", pid: idOf(b, n), value: v }));
    t("P1", 12.5);
    t("P1", 11.2);
    t("P2", 11.2);
    t("P2", 14);
    t("P3", 10.01);
    assert.deepEqual(places(b), { P3: 1, P1: 2, P2: 3 });
    assert.equal(derive(b).standings[0].value, 10.01);
    assert.equal(derive(b).standings[1].cells.tries, 2);
  });

  test("attempt limits, removal, and no place without an attempt", () => {
    let b = act(board("best", 2, { best: { maxAttempts: 1 } }), { type: "start" });
    b = act(b, { type: "attempt", pid: idOf(b, "P1"), value: 180 });
    assert.equal(applyAction(b, { type: "attempt", pid: idOf(b, "P1"), value: 100 }, env()).ok, false);
    assert.deepEqual(places(b), { P1: 1, P2: 0 });
    b = act(b, { type: "removeAttempt", id: b.attempts[0].id });
    assert.deepEqual(places(b), { P1: 0, P2: 0 });
  });
});

describe("board actions", () => {
  test("pasted names: one per line, duplicates renamed, team members after a colon", () => {
    assert.deepEqual(parseEntrants("Alex\n\n  Sam  \nThe Quizzards: Jo, Kim\nA, B"), [
      { name: "Alex" },
      { name: "Sam" },
      { name: "The Quizzards", members: ["Jo", "Kim"] },
      { name: "A", members: ["B"] },
    ]);
    let b = board("points", 0);
    b = act(b, { type: "addParticipants", names: ["Alex\nalex\nAlex"] });
    assert.deepEqual(b.participants.map((p) => p.name), ["Alex", "alex (2)", "Alex (3)"]);
  });

  test("every change bumps the version", () => {
    const b = board("points", 1);
    const r = applyAction(b, { type: "rename", title: "Trivia Thursday" }, env());
    assert.ok(r.ok && r.board.version === b.version + 1 && r.board.title === "Trivia Thursday");
    assert.equal(applyAction(b, { type: "rename", title: "  " }, env()).ok, false);
  });

  test("starting needs enough entrants; finishing records the winner; reopening clears it", () => {
    const empty = board("single", 1);
    assert.equal(applyAction(empty, { type: "start" }, env()).ok, false);
    let b = act(board("single", 2), { type: "start" });
    const m = derive(b).matches[0];
    b = act(b, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id });
    b = act(b, { type: "finish" });
    assert.equal(b.status, "finished");
    assert.deepEqual(b.winners, [nameOf(b, (m.a as { id: string }).id)]);
    b = act(b, { type: "reopen" });
    assert.equal(b.status, "live");
    assert.equal(b.winners, undefined);
  });

  test("a points board finished on a tie lists both winners", () => {
    let b = act(board("points", 2), { type: "start" });
    for (const n of ["P1", "P2"]) b = act(b, { type: "score", pid: idOf(b, n), roundId: "r1", value: 5 });
    b = act(b, { type: "finish" });
    assert.deepEqual(b.winners, ["P1", "P2"]);
  });

  test("the format can change only in draft; shuffling seeds is repeatable with the same rng", () => {
    let b = board("single", 8);
    b = act(b, { type: "format", format: "double" });
    assert.equal(b.format, "double");
    const shuffle = (seed: number) => {
      let x = seed;
      const r = applyAction(b, { type: "shuffle" }, { ...env(), random: () => ((x = (x * 9301 + 49297) % 233280) / 233280) });
      return r.ok ? r.board.seeds : [];
    };
    assert.deepEqual(shuffle(7), shuffle(7));
    assert.equal(new Set(shuffle(7)).size, 8);
    const live = act(b, { type: "start" });
    assert.equal(applyAction(live, { type: "format", format: "single" }, env()).ok, false);
    assert.equal(applyAction(live, { type: "shuffle" }, env()).ok, false);
  });

  test("themes: presets apply, colors are checked, emoji is short", () => {
    const t = mergeTheme(presetTheme("classic"), { preset: "pool", accent: "javascript:alert(1)", emoji: "🎱🎱🎱🎱🎱🎱" });
    assert.equal(t.preset, "pool");
    assert.equal(t.accent, presetTheme("pool").accent);
    assert.equal([...t.emoji].length, 4);
    const t2 = mergeTheme(t, { background: { kind: "image", image: "../../etc/passwd" } });
    assert.equal(t2.background.image, undefined);
    const t3 = mergeTheme(t, { background: { kind: "image", image: "abcdef1234.png" } });
    assert.equal(t3.background.image, "abcdef1234.png");
  });
});

describe("seasons", () => {
  test("a season board sums nightly boards by placement, matching names", () => {
    const night = (id: string, order: string[], when: number) => {
      let b: Board = { ...newBoard(id, "Trivia", "points", when), startedAt: when };
      b = act(b, { type: "addParticipants", names: [order.join("\n")] });
      b = act(b, { type: "start" });
      order.forEach((n, i) => (b = act(b, { type: "score", pid: idOf(b, n), roundId: "r1", value: 10 - i })));
      return b;
    };
    const n1 = night("n1", ["Quizzards", "Brainiacs", "Table 6"], Date.UTC(2026, 10, 5, 20));
    const n2 = night("n2", ["brainiacs", "Quizzards", "Newbies"], Date.UTC(2026, 10, 12, 20));
    let season = newBoard("s", "Fall league", "points", 1);
    season = act(season, { type: "season", season: { boards: ["n1", "n2"], scoring: "placement", placePoints: [10, 8, 6] } });
    const view = withSeason(season, [n1, n2]);
    const d = derive(view);
    const pts = Object.fromEntries(d.standings.map((r) => [r.name, r.value]));
    assert.deepEqual(pts, { Quizzards: 18, Brainiacs: 18, "Table 6": 6, Newbies: 6 });
    assert.equal(d.columns.length, 2);
    // Scores are entered on the nightly boards, not the season.
    assert.equal(applyAction(season, { type: "score", pid: "x", roundId: "s0", value: 1 }, env()).ok, false);
  });

  test("typed-in nights, a bracket night and aliases, in date order", () => {
    let cup: Board = { ...newBoard("c1", "Cup", "single", Date.UTC(2026, 10, 8, 20)), startedAt: Date.UTC(2026, 10, 8, 20) };
    cup = act(cup, { type: "addParticipants", names: ["Quizzards\nBrainiacs"] });
    cup = act(cup, { type: "start" });
    cup = act(cup, { type: "result", matchId: "W1.0", winner: idOf(cup, "Brainiacs") });
    let season = newBoard("s", "Fall league", "points", 1);
    season = act(season, {
      type: "season",
      season: {
        boards: ["c1"],
        scoring: "placement",
        placePoints: [10, 8, 6],
        nights: [
          { id: "late1", title: "Nov 15", at: Date.UTC(2026, 10, 15, 20), results: readNight("1. Quizards 52\n2. Brainiacs 40\n3. Table Six 12") },
          { id: "early1", title: "Nov 1", at: Date.UTC(2026, 10, 1, 20), results: [{ name: "Quizzards", place: 1 }, { name: "", place: 2 }] },
        ],
        aliases: { "quizards": "Quizzards", "Brainiacs": "Brainiacs" },
      },
    });
    assert.equal(season.season!.nights![1].results.length, 1, "a nameless row is dropped");
    assert.deepEqual(season.season!.aliases, { quizards: "Quizzards" }, "an alias to itself is dropped");
    assert.ok(hasSeason(season));
    const d = derive(withSeason(season, [cup]));
    const pts = Object.fromEntries(d.standings.map((r) => [r.name, r.value]));
    assert.deepEqual(pts, { Quizzards: 28, Brainiacs: 18, "Table Six": 6 });
    const v = withSeason(season, [cup]);
    assert.deepEqual(v.settings.points.rounds.map((r) => r.name), ["Nov 1", "11/8", "Nov 15"]);
  });

  test("readNight: places, scores, or just the order", () => {
    assert.deepEqual(readNight("Place, Team\n1st Quizzards\n2) Brainiacs\n2. Table 6"), [
      { name: "Quizzards", place: 1 },
      { name: "Brainiacs", place: 2 },
      { name: "Table 6", place: 2 },
    ]);
    assert.deepEqual(readNight("Brainiacs, 38\nQuizzards	42 pts\nNewbies 38"), [
      { name: "Quizzards", place: 1, score: 42 },
      { name: "Brainiacs", place: 2, score: 38 },
      { name: "Newbies", place: 2, score: 38 },
    ]);
    assert.deepEqual(readNight("Ann\nBo"), [
      { name: "Ann", place: 1 },
      { name: "Bo", place: 2 },
    ]);
  });

  test("similarNames: other spellings of the same team, not the same name", () => {
    const known = ["Quizzards", "The Brainiacs", "Table 6", "Bo"];
    assert.deepEqual(similarNames("Quizards", known), ["Quizzards"]);
    assert.deepEqual(similarNames("brainiacs!", known), ["The Brainiacs"]);
    assert.deepEqual(similarNames("quizzards", known), [], "same name, other case: not a near miss");
    assert.deepEqual(similarNames("Bob", known), [], "too short to guess");
    assert.deepEqual(similarNames("Night Owls", known), []);
  });
});

describe("CSV", () => {
  test("exports standings and matches, and defuses formulas", () => {
    let b = act(board("single", 2), { type: "rename", title: "=HYPERLINK(1)" });
    b = act(b, { type: "editParticipant", id: idOf(b, "P1"), name: "@evil" });
    b = act(b, { type: "start" });
    const m = derive(b).matches[0];
    b = act(b, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id, scoreA: 2, scoreB: 0 });
    const csv = boardCsv(b);
    assert.ok(csv.startsWith("'=HYPERLINK(1),Single elimination,live"));
    assert.ok(csv.includes("'@evil"));
    assert.ok(csv.includes("Final,'@evil,P2,2,0,'@evil,"));
  });
});
