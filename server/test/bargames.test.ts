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
