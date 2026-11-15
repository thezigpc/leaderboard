// Bar Games: standalone stays standalone; on a (fake) box the venue's name, staff sign-in,
// events, results, countdowns and attention reach the box.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { BoardView } from "@leaderboard/shared";
import { fakeCore, startApp, TOKEN, until, type FakeCore, type TestApp } from "./helpers.js";

const STAFF = { "x-bargames-via": "1", "x-bargames-staff": "1" };

describe("standalone", () => {
  let t: TestApp;
  before(async () => (t = await startApp({ gameName: "Bar Boards" })));
  after(() => t.stop());

  test("no box sign-in, no box password, staff headers ignored", async () => {
    const s = (await (await t.get("/api/admin/status")).json()) as { venueLogin: boolean; trusted: boolean };
    assert.deepEqual([s.venueLogin, s.trusted], [false, false]);
    assert.equal((await t.send("POST", "/api/admin/login", { password: "box-password" })).status, 409);
    assert.equal((await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).status, 403);
  });
});

describe("on a box", () => {
  let core: FakeCore;
  let t: TestApp;
  let clock = Date.UTC(2026, 10, 13, 20);
  before(async () => {
    core = await fakeCore();
    t = await startApp({ coreUrl: core.url, token: TOKEN, attentionEveryMs: 50, now: () => clock });
  });
  after(async () => {
    await t.stop();
    await core.close();
  });

  const events = (type: string) => core.posts.filter((p) => p.path === "POST /internal/events" && p.body.type === type);

  test("the venue's name, and status lists no rooms", async () => {
    assert.equal(((await (await t.get("/api/config")).json()) as { gameName: string }).gameName, "Leaderboard at Test Bar");
    const r = await fetch(t.url + "/__bargames/status", { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.deepEqual(await r.json(), { rooms: [] });
  });

  test("guests can't claim the admin; the box's password and box staff sign in", async () => {
    assert.equal((await t.send("POST", "/api/admin/setup", { password: "guest-grabs-it" })).status, 403);
    const r = (await (await t.send("POST", "/api/admin/login", { password: "box-password" })).json()) as { token: string };
    assert.ok(r.token);
    const s = (await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string };
    assert.ok(s.token);
  });

  test("events, a leader change and the results reach the box", async () => {
    const tok = ((await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string }).token;
    const staff = { authorization: `Bearer ${tok}` };
    const v = await t.board(staff, "Trivia Night", "points", ["Quizzards", "Brainiacs"]);
    const [q, b] = v.board.participants;
    await t.act(staff, v.board.id, { type: "start" });
    await until(() => events("x-leaderboard-board-started").length === 1);
    await t.act(staff, v.board.id, { type: "score", pid: q.id, roundId: "r1", value: 5 });
    await until(() => events("x-leaderboard-leader-changed").length === 1);
    assert.equal(events("x-leaderboard-leader-changed")[0].body.data && (events("x-leaderboard-leader-changed")[0].body.data as { leader: string }).leader, "Quizzards");
    await t.act(staff, v.board.id, { type: "score", pid: b.id, roundId: "r1", value: 9 });
    await until(() => events("x-leaderboard-leader-changed").length === 2);
    assert.equal((events("x-leaderboard-result").at(-1)!.body.data as { name: string }).name, "Brainiacs");
    await t.act(staff, v.board.id, { type: "finish" });
    await until(() => events("x-leaderboard-board-finished").length === 1);
    assert.deepEqual((events("x-leaderboard-board-finished")[0].body.data as { winners: string[] }).winners, ["Brainiacs"]);
    assert.equal((events("winner")[0].body.data as { name: string }).name, "Brainiacs");
    await until(() => core.posts.some((p) => p.path === "POST /internal/results"));
    const results = core.posts.find((p) => p.path === "POST /internal/results")!.body as { results: { player: { name: string }; place: number }[] };
    assert.deepEqual(results.results.map((r) => [r.player.name, r.place]), [
      ["Brainiacs", 1],
      ["Quizzards", 2],
    ]);
  });

  test("a bracket result says who beat whom", async () => {
    const tok = ((await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string }).token;
    const staff = { authorization: `Bearer ${tok}` };
    const v = await t.board(staff, "Pool", "single", ["Ann", "Bo"]);
    await t.act(staff, v.board.id, { type: "start" });
    const d = ((await (await t.get(`/api/boards/${v.board.id}`)).json()) as BoardView).derived;
    const m = d.matches[0];
    const before = events("x-leaderboard-result").length;
    await t.act(staff, v.board.id, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id, scoreA: 3, scoreB: 1 });
    await until(() => events("x-leaderboard-result").length === before + 1);
    const data = events("x-leaderboard-result").at(-1)!.body.data as { winner: string; loser: string; score: string; match: string };
    assert.deepEqual([data.match, data.score], ["Final", "3-1"]);
    assert.notEqual(data.winner, data.loser);
  });

  test("a called match waiting too long asks staff to look, and clears when played", async () => {
    const tok = ((await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string }).token;
    const staff = { authorization: `Bearer ${tok}` };
    const v = await t.board(staff, "Cornhole", "single", ["Ann", "Bo"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    await t.act(staff, id, { type: "lanes", lanes: ["Board 2"] });
    await t.act(staff, id, { type: "lane", matchId: "W1.0", lane: "Board 2" });
    clock += 25 * 60_000;
    const attention = () => core.posts.filter((p) => p.path === "POST /internal/attention");
    await until(() => attention().some((p) => (p.body.items as unknown[]).length === 1));
    const item = (attention().at(-1)!.body.items as { message: string; actionPath: string }[])[0];
    assert.match(item.message, /Cornhole: Ann vs Bo on Board 2 has waited 25 min/);
    assert.equal(item.actionPath, `/host/${id}`);
    const d = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).derived;
    await t.act(staff, id, { type: "result", matchId: "W1.0", winner: (d.matches[0].a as { id: string }).id });
    await until(() => (attention().at(-1)!.body.items as unknown[]).length === 0);
  });

  test("a countdown from the host's phone", async () => {
    const tok = ((await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string }).token;
    const r = await t.send("POST", "/api/countdown", { label: "Cornhole starts in", minutes: 10 }, { authorization: `Bearer ${tok}` });
    assert.equal(r.status, 200);
    const sent = core.posts.find((p) => p.path === "POST /internal/countdown")!;
    assert.deepEqual(sent.body, { label: "Cornhole starts in", minutes: 10 });
    assert.equal((await t.send("DELETE", "/api/countdown", null, { authorization: `Bearer ${tok}` })).status, 200);
    assert.ok(core.posts.some((p) => p.path === "DELETE /internal/countdown"));
  });
});

describe("bracket matches played in games on the box (SDK 0.15.0)", () => {
  let core: FakeCore;
  let t: TestApp;
  let staff: Record<string, string>;
  before(async () => {
    core = await fakeCore();
    t = await startApp({ coreUrl: core.url, token: TOKEN });
    const tok = ((await (await fetch(t.url + "/api/admin/trusted", { method: "POST", headers: STAFF })).json()) as { token: string }).token;
    staff = { authorization: `Bearer ${tok}` };
  });
  after(async () => {
    await t.stop();
    await core.close();
  });

  const view = async (id: string) => (await (await t.get(`/api/boards/${id}`)).json()) as BoardView;
  const matchResult = (match: Record<string, unknown>) =>
    fetch(t.url + "/__bargames/command", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "match_result", args: { match } }),
    });
  const play = (id: string, matchId: string, gameId = "pool") => t.send("POST", `/api/boards/${id}/matches/${matchId}/play`, { gameId }, staff);

  test("only games that fit two sides are offered, to scorekeepers", async () => {
    assert.equal((await t.get("/api/match-games")).status, 401);
    const r = (await (await t.get("/api/match-games", staff)).json()) as { games: { id: string; name: string }[] };
    assert.deepEqual(r.games, [{ id: "pool", name: "Pool" }]);
  });

  test("start → the game's result fills in the bracket and the winner moves on", async () => {
    const v = await t.board(staff, "Pool Night", "single", ["Ann", "Bo", "Cy", "Di"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    let d = (await view(id)).derived;
    const m = d.matches.find((x) => x.state === "ready")!;
    const [a, b] = [(m.a as { id: string }).id, (m.b as { id: string }).id];
    const r = await play(id, m.id);
    assert.equal(r.status, 200);
    const started = [...core.matches.values()].at(-1)!;
    assert.equal(started.gameId, "pool");
    assert.deepEqual((started.players as { id: string }[]).map((p) => p.id), [a, b]);
    assert.match(String(started.title), /Pool Night: /);
    d = (await view(id)).derived;
    assert.deepEqual(d.matches.find((x) => x.id === m.id)!.game, { name: "Pool", room: "R1", joinUrl: "https://testbar.example/pool/join" });
    assert.equal((await play(id, m.id)).status, 409, "already playing");

    const names = new Map((await view(id)).board.participants.map((p) => [p.id, p.name]));
    const res = await matchResult({
      ...started,
      status: "done",
      result: { matchId: started.matchId, results: [{ player: { name: names.get(b) }, place: 1, score: 5 }, { player: { name: names.get(a) }, place: 2, score: 3 }] },
    });
    assert.deepEqual(await res.json(), { ok: true });
    const after = await view(id);
    const done = after.derived.matches.find((x) => x.id === m.id)!;
    assert.equal(done.state, "done");
    assert.equal(done.winner, b);
    assert.deepEqual([done.result!.scoreA, done.result!.scoreB], [3, 5]);
    assert.equal(done.game, undefined);
    const next = after.derived.matches.find((x) => x.id === done.winnerTo)!;
    assert.ok([next.a, next.b].some((s) => s.kind === "player" && s.id === b), "the winner moved on");
  });

  test("a room that closes without a result puts the match back to ready, with a note", async () => {
    const v = await t.board(staff, "Darts", "single", ["Ann", "Bo"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    await play(id, "W1.0");
    const rec = [...core.matches.values()].at(-1)!;
    await matchResult({ ...rec, status: "cancelled" });
    const m = (await view(id)).derived.matches[0];
    assert.equal(m.state, "ready");
    assert.equal(m.game, undefined);
    assert.match(m.note!, /Pool room R\d+ closed without a result/);
    // Played again: a fresh match id for the box, and the note goes.
    assert.equal((await play(id, "W1.0")).status, 200);
    const again = [...core.matches.values()].at(-1)!;
    assert.notEqual(again.matchId, rec.matchId);
    const m2 = (await view(id)).derived.matches[0];
    assert.equal(m2.note, undefined);
    assert.ok(m2.game);
  });

  test("a result typed in by hand wins; the game's later result is ignored", async () => {
    const v = await t.board(staff, "Cornhole", "single", ["Ann", "Bo"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    await play(id, "W1.0");
    const rec = [...core.matches.values()].at(-1)!;
    const m = (await view(id)).derived.matches[0];
    const a = (m.a as { id: string }).id;
    await t.act(staff, id, { type: "result", matchId: "W1.0", winner: a });
    const players = rec.players as { name: string }[];
    const other = players.find((p) => p.name !== "Ann" && p.name !== (m.a as { id: string }).id)!;
    await matchResult({ ...rec, status: "done", result: { results: [{ player: { name: other.name }, place: 1 }] } });
    const after = (await view(id)).derived.matches[0];
    assert.equal(after.winner, a);
  });

  test("a phone can't send the box's change; a result missed while down is picked up by polling", async () => {
    const v = await t.board(staff, "Chess", "single", ["Ann", "Bo"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    const bad = await t.act(staff, id, { type: "gameLink", matchId: "W1.0", game: null });
    assert.equal(bad.status, 400);
    await play(id, "W1.0");
    const rec = [...core.matches.values()].at(-1)!;
    const winner = (rec.players as { name: string; id: string }[])[1];
    core.matches.set(String(rec.matchId), { ...rec, status: "done", result: { results: [{ player: { name: winner.name }, place: 1 }] } });
    await t.lb.matches.poll();
    assert.equal((await view(id)).derived.matches[0].winner, winner.id);
  });

  test("off a box: no games, and Play refuses", async () => {
    const solo = await startApp({});
    const s = await solo.staff();
    assert.deepEqual(await (await solo.get("/api/match-games", s)).json(), { games: [] });
    const v = await solo.board(s, "X", "single", ["A", "B"]);
    await solo.act(s, v.board.id, { type: "start" });
    assert.equal((await solo.send("POST", `/api/boards/${v.board.id}/matches/W1.0/play`, { gameId: "pool" }, s)).status, 400);
    await solo.stop();
  });
});
