import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import type { BoardSummary, BoardView, DerivedMatch, PeopleSeen } from "@leaderboard/shared";
import { startApp, until, type TestApp } from "./helpers.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

describe("standalone basics", () => {
  let t: TestApp;
  before(async () => (t = await startApp({ gameName: "Thursday Boards" })));
  after(() => t.stop());

  test("health, config, and venue.json says standalone", async () => {
    assert.equal((await t.get("/health")).status, 200);
    const cfg = (await (await t.get("/api/config")).json()) as { gameName: string; onBox: boolean };
    assert.deepEqual([cfg.gameName, cfg.onBox], ["Thursday Boards", false]);
    const v = (await (await t.get("/__bargames/venue.json")).json()) as { standalone: boolean };
    assert.equal(v.standalone, true);
    assert.equal((await t.get("/__bargames/status")).status, 401);
  });

  test("unknown API paths are JSON 404s", async () => {
    const r = await t.get("/api/nope");
    assert.equal(r.status, 404);
    assert.equal(((await r.json()) as { ok: boolean }).ok, false);
  });
});

describe("boards and keeping score", () => {
  let t: TestApp;
  let staff: Record<string, string>;
  before(async () => {
    t = await startApp();
    staff = await t.staff();
  });
  after(() => t.stop());

  test("creating a board needs staff; reading is public", async () => {
    assert.equal((await t.send("POST", "/api/boards", { title: "X", format: "points" })).status, 401);
    const v = await t.board(staff, "Trivia Night", "points", ["Quizzards", "Brainiacs"]);
    assert.equal(v.board.title, "Trivia Night");
    assert.equal(v.board.participants.length, 2);
    const list = (await (await t.get("/api/boards")).json()) as BoardSummary[];
    assert.ok(list.some((b) => b.id === v.board.id && b.participants === 2));
    assert.equal((await t.get(`/api/boards/${v.board.id}`)).status, 200);
  });

  test("changes need a sign-in", async () => {
    const v = await t.board(staff, "Pool", "single", ["A", "B"]);
    const r = await t.act({}, v.board.id, { type: "start" });
    assert.equal(r.status, 401);
  });

  test("a stale version is refused with the latest board", async () => {
    const v = await t.board(staff, "Darts", "best", ["Ann", "Bo"]);
    const first = await t.act(staff, v.board.id, { type: "start" }, v.board.version);
    assert.equal(first.status, 200);
    const second = await t.act(staff, v.board.id, { type: "rename", title: "Late" }, v.board.version);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "STALE");
    assert.equal((second.body.view as BoardView).board.status, "live");
  });

  test("a bracket: results, re-flow warning, undo", async () => {
    const v = await t.board(staff, "Cornhole", "single", ["A", "B", "C", "D"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    const play = async (m: DerivedMatch) => t.act(staff, id, { type: "result", matchId: m.id, winner: (m.a as { id: string }).id });
    let d = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).derived;
    for (const m of d.matches.filter((x) => x.state === "ready")) await play(m);
    d = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).derived;
    const final = d.matches.find((m) => m.id === "W2.0")!;
    await play(final);
    // Change a semifinal: the final would be cleared, so it asks first.
    const semi = d.matches.find((m) => m.id === "W1.0")!;
    const r = await t.act(staff, id, { type: "result", matchId: "W1.0", winner: (semi.b as { id: string }).id });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "REFLOW");
    assert.deepEqual(r.body.affected, ["Final"]);
    const forced = await t.act(staff, id, { type: "result", matchId: "W1.0", winner: (semi.b as { id: string }).id, force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.derived!.matches.find((m) => m.id === "W2.0")!.state, "ready");
    // Undo puts the final back.
    const cur = (await (await t.get(`/api/boards/${id}`)).json()) as BoardView & { canUndo: boolean };
    assert.equal(cur.canUndo, true);
    const u = await t.send("POST", `/api/boards/${id}/undo`, { version: cur.board.version }, staff);
    assert.equal(u.status, 200);
    const back = (await u.json()) as BoardView;
    assert.equal(back.derived.matches.find((m) => m.id === "W2.0")!.state, "done");
    assert.ok(back.derived.complete);
  });

  test("CSV export", async () => {
    const v = await t.board(staff, "Export me", "points", ["Team =1"]);
    const r = await t.get(`/api/boards/${v.board.id}/export.csv`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition")!, /Export-me\.csv/);
    const text = await r.text();
    assert.ok(text.includes("Team =1"));
  });

  test("templates copy the setup, optionally the entrants", async () => {
    const v = await t.board(staff, "League week 1", "roundrobin", ["A", "B", "C"]);
    await t.act(staff, v.board.id, { type: "lanes", lanes: ["Table 1"] });
    const r = await t.send("POST", "/api/boards", { title: "League week 2", format: "points", copyFrom: v.board.id, keepEntrants: true }, staff);
    const copy = (await r.json()) as BoardView;
    assert.equal(copy.board.format, "roundrobin");
    assert.deepEqual(copy.board.lanes, ["Table 1"]);
    assert.deepEqual(copy.board.participants.map((p) => p.name), ["A", "B", "C"]);
    assert.equal(copy.board.status, "draft");
  });

  test("a knockout seeded from a round robin's standings", async () => {
    const v = await t.board(staff, "Groups", "roundrobin", ["A", "B", "C", "D"]);
    const id = v.board.id;
    await t.act(staff, id, { type: "start" });
    let d = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).derived;
    for (const m of d.matches) {
      const [a, b] = [(m.a as { id: string }).id, (m.b as { id: string }).id];
      const names = new Map(v.board.participants.map((p) => [p.id, p.name]));
      await t.act(staff, id, { type: "result", matchId: m.id, winner: names.get(a)! < names.get(b)! ? a : b });
    }
    d = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).derived;
    assert.ok(d.complete);
    const r = await t.send("POST", "/api/boards", { title: "Finals", format: "single", seedFrom: { boardId: id, top: 2 } }, staff);
    const ko = (await r.json()) as BoardView;
    assert.deepEqual(ko.board.participants.map((p) => p.name), ["A", "B"]);
    assert.equal(ko.board.settings.single.seeding, "board");
  });

  test("a pairs board, its teams and waiting players, and the regulars list", async () => {
    const r = await t.send("POST", "/api/boards", { title: "Cornhole Doubles", format: "single", preset: "cornhole", entry: { kind: "teams", size: 2 } }, staff);
    const v = (await r.json()) as BoardView;
    assert.deepEqual(v.board.entry, { kind: "teams", size: 2 });
    assert.deepEqual(v.board.waiting, []);
    const a = await t.act(staff, v.board.id, { type: "arrange", teams: [{ name: "Bag Ladies", members: ["Mia", "Dee"] }, { name: "Corn Stars", members: ["Jo", "Kim"] }], waiting: ["Sam"] });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.board!.waiting, ["Sam"]);
    await t.act(staff, v.board.id, { type: "start" });
    // Drafts don't count as regulars; a started board does. Scorekeepers only.
    assert.equal((await t.get("/api/people")).status, 401);
    const people = (await (await fetch(`${t.url}/api/people`, { headers: staff })).json()) as PeopleSeen;
    const team = people.teams.find((x) => x.name === "Bag Ladies")!;
    assert.deepEqual(team.members, ["Mia", "Dee"]);
    assert.ok(team.presets.includes("cornhole"));
    assert.ok(people.players.some((p) => p.name === "Kim"));
    assert.ok(!people.players.some((p) => p.name === "Sam"));
    const without = (await (await fetch(`${t.url}/api/people?exclude=${v.board.id}`, { headers: staff })).json()) as PeopleSeen;
    assert.ok(!without.teams.some((x) => x.name === "Bag Ladies"));
    // A copy remembers where it came from (for "keep last week's finalists apart").
    const c = await t.send("POST", "/api/boards", { title: "Next week", format: "single", copyFrom: v.board.id, keepEntrants: true }, staff);
    const copy = (await c.json()) as BoardView;
    assert.equal(copy.board.copiedFrom, v.board.id);
    assert.deepEqual(copy.board.entry, { kind: "teams", size: 2 });
    assert.deepEqual(copy.board.participants.map((p) => [p.name, p.members]), [
      ["Bag Ladies", ["Mia", "Dee"]],
      ["Corn Stars", ["Jo", "Kim"]],
    ]);
  });

  test("deleting is staff only", async () => {
    const v = await t.board(staff, "Gone soon", "points");
    assert.equal((await t.send("DELETE", `/api/boards/${v.board.id}`, null)).status, 401);
    assert.equal((await t.send("DELETE", `/api/boards/${v.board.id}`, null, staff)).status, 200);
    assert.equal((await t.get(`/api/boards/${v.board.id}`)).status, 404);
  });
});

describe("scorekeeper PINs", () => {
  let t: TestApp;
  let staff: Record<string, string>;
  before(async () => {
    t = await startApp();
    staff = await t.staff();
  });
  after(() => t.stop());

  test("a PIN lets a scorer keep score on that board only", async () => {
    const mine = await t.board(staff, "Trivia", "points", ["A"]);
    const other = await t.board(staff, "Other", "points", ["B"]);
    assert.equal((await t.send("PUT", `/api/boards/${mine.board.id}/pin`, { pin: "12" }, staff)).status, 400);
    assert.equal((await t.send("PUT", `/api/boards/${mine.board.id}/pin`, { pin: "4321" })).status, 401);
    const set = await t.send("PUT", `/api/boards/${mine.board.id}/pin`, { pin: "4321" }, staff);
    assert.equal(set.status, 200);
    const pub = (await (await t.get(`/api/boards/${mine.board.id}`)).json()) as BoardView;
    assert.equal(pub.board.hasPin, true);
    assert.ok(!("pin" in pub.board), "the PIN hash never leaves the server");

    assert.equal((await t.send("POST", `/api/boards/${mine.board.id}/pin-login`, { pin: "0000" })).status, 401);
    const ok = (await (await t.send("POST", `/api/boards/${mine.board.id}/pin-login`, { pin: "4321" })).json()) as { token: string };
    const scorer = { "x-scorer": ok.token };
    const me = (await (await t.get("/api/me", scorer)).json()) as { staff: boolean; boards: string[] };
    assert.deepEqual(me, { staff: false, boards: [mine.board.id], canCreate: false });
    assert.equal((await t.act(scorer, mine.board.id, { type: "score", pid: mine.board.participants[0].id, roundId: "r1", value: 7 })).status, 200);
    assert.equal((await t.act(scorer, other.board.id, { type: "rename", title: "Hacked" })).status, 401);
    // Nor staff-only things.
    assert.equal((await t.send("DELETE", `/api/boards/${mine.board.id}`, null, scorer)).status, 401);
    assert.equal((await t.send("POST", "/api/boards", { title: "x", format: "points" }, scorer)).status, 401);
    // TVs: only their own board.
    assert.equal((await t.send("PUT", "/api/tv", { mode: "board", boardId: other.board.id }, scorer)).status, 401);
    assert.equal((await t.send("PUT", "/api/tv", { mode: "board", boardId: mine.board.id }, scorer)).status, 200);
    // A new PIN signs them out.
    await t.send("PUT", `/api/boards/${mine.board.id}/pin`, { pin: "9999" }, staff);
    assert.equal((await t.act(scorer, mine.board.id, { type: "rename", title: "Nope" })).status, 401);
    // So does clearing it.
    const again = (await (await t.send("POST", `/api/boards/${mine.board.id}/pin-login`, { pin: "9999" })).json()) as { token: string };
    await t.send("PUT", `/api/boards/${mine.board.id}/pin`, { pin: null }, staff);
    assert.equal((await t.act({ "x-scorer": again.token }, mine.board.id, { type: "rename", title: "Nope" })).status, 401);
  });

  test("wrong PINs are limited", async () => {
    const v = await t.board(staff, "Locked", "points");
    await t.send("PUT", `/api/boards/${v.board.id}/pin`, { pin: "5555" }, staff);
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await t.send("POST", `/api/boards/${v.board.id}/pin-login`, { pin: "1111" })).status;
    assert.equal(last, 429);
    // Even the right PIN waits now.
    assert.equal((await t.send("POST", `/api/boards/${v.board.id}/pin-login`, { pin: "5555" })).status, 429);
  });
});

describe("hosts who aren't staff starting boards", () => {
  let t: TestApp;
  let staff: Record<string, string>;
  before(async () => {
    t = await startApp();
    staff = await t.staff();
  });
  after(() => t.stop());
  const cfg = async () => ((await (await t.get("/api/config")).json()) as { newBoards: string }).newBoards;
  const create = (h: Record<string, string> = {}) => t.send("POST", "/api/boards", { title: "Quiz", format: "points", preset: "trivia" }, h);

  test("staff only by default; a PIN mode without a PIN stays staff only", async () => {
    assert.equal(await cfg(), "staff");
    assert.equal((await create()).status, 401);
    await t.send("PUT", "/api/admin/settings", { newBoards: "pin" }, staff);
    assert.equal(await cfg(), "staff");
    assert.equal((await t.send("POST", "/api/host-login", { pin: "1234" })).status, 400);
  });

  test("the host PIN: hashed, never shown, lets a host start a board and score only it", async () => {
    assert.equal((await t.send("PUT", "/api/admin/settings", { hostPin: "12" }, staff)).status, 400);
    const r = (await (await t.send("PUT", "/api/admin/settings", { newBoards: "pin", hostPin: "2468" }, staff)).json()) as { settings: Record<string, unknown> };
    assert.equal(r.settings.hostPinSet, true);
    assert.ok(!("hostPin" in r.settings), "the hash never leaves the server");
    const got = (await (await t.get("/api/admin/settings", staff)).json()) as Record<string, unknown>;
    assert.deepEqual([got.hostPinSet, "hostPin" in got], [true, false]);
    assert.equal(await cfg(), "pin");

    assert.equal((await create()).status, 401);
    assert.equal((await t.send("POST", "/api/host-login", { pin: "0000" })).status, 401);
    const { token } = (await (await t.send("POST", "/api/host-login", { pin: "2468" })).json()) as { token: string };
    const host = { "x-host": token };
    assert.equal(((await (await t.get("/api/me", host)).json()) as { canCreate: boolean }).canCreate, true);
    const made = (await (await create(host)).json()) as BoardView & { scorer: { token: string; pin: string } };
    assert.match(made.scorer.pin, /^\d{4}$/);
    assert.equal(made.board.hasPin, true);
    const scorer = { ...host, "x-scorer": made.scorer.token };
    assert.equal((await t.act(scorer, made.board.id, { type: "addParticipants", names: ["Quizzards\nBrainiacs"] })).status, 200);
    // A second phone joins with the board's PIN.
    assert.equal((await t.send("POST", `/api/boards/${made.board.id}/pin-login`, { pin: made.scorer.pin })).status, 200);
    // Not other boards, nor staff things.
    const other = await t.board(staff, "Staff board", "points", ["A"]);
    assert.equal((await t.act(scorer, other.board.id, { type: "rename", title: "Nope" })).status, 401);
    assert.equal((await t.send("DELETE", `/api/boards/${made.board.id}`, null, scorer)).status, 401);
    assert.equal((await t.get("/api/admin/settings", scorer)).status, 401);
    // A new host PIN signs hosts out (their board's scorer token still works).
    await t.send("PUT", "/api/admin/settings", { hostPin: "1357" }, staff);
    assert.equal((await create(host)).status, 401);
    assert.equal((await t.act(scorer, made.board.id, { type: "rename", title: "Still mine" })).status, 200);
    // Clearing the PIN makes it staff only again.
    await t.send("PUT", "/api/admin/settings", { hostPin: null }, staff);
    assert.equal(await cfg(), "staff");
  });

  test("anyone may start boards when the venue allows it, a few an hour", async () => {
    await t.send("PUT", "/api/admin/settings", { newBoards: "open" }, staff);
    assert.equal(await cfg(), "open");
    assert.equal(((await (await t.get("/api/me")).json()) as { canCreate: boolean }).canCreate, true);
    let status = 0;
    for (let i = 0; i < 13; i++) status = (await create()).status;
    assert.equal(status, 429);
    // Staff aren't counted.
    assert.equal((await create(staff)).status, 200);
    await t.send("PUT", "/api/admin/settings", { newBoards: "staff" }, staff);
  });
});

describe("TV settings, uploads, admin settings", () => {
  let t: TestApp;
  let staff: Record<string, string>;
  before(async () => {
    t = await startApp();
    staff = await t.staff();
  });
  after(() => t.stop());

  test("TV mode is kept in range", async () => {
    const r = await t.send("PUT", "/api/tv", { mode: "rotate", boardIds: ["abcdefgh", "../x"], rotateSeconds: 1 }, staff);
    const body = (await r.json()) as { tv: { mode: string; boardIds: string[]; rotateSeconds: number } };
    assert.deepEqual([body.tv.mode, body.tv.boardIds, body.tv.rotateSeconds], ["rotate", ["abcdefgh"], 5]);
    assert.deepEqual(((await (await t.get("/api/tv")).json()) as { mode: string }).mode, "rotate");
  });

  test("uploads take real images only, and serve them safely", async () => {
    assert.equal((await fetch(t.url + "/api/uploads", { method: "POST", body: PNG })).status, 401);
    const bad = await fetch(t.url + "/api/uploads", { method: "POST", headers: staff, body: Buffer.from("<svg onload=alert(1)>") });
    assert.equal(bad.status, 400);
    const good = (await (await fetch(t.url + "/api/uploads", { method: "POST", headers: { ...staff, "content-type": "image/png" }, body: PNG })).json()) as { file: string };
    assert.match(good.file, /^[a-f0-9]{20}\.png$/);
    const img = await t.get(`/uploads/${good.file}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await t.get("/uploads/../admin.json")).status, 404);
  });

  test("admin settings need staff and are cleaned", async () => {
    assert.equal((await t.get("/api/admin/settings")).status, 401);
    const r = await t.send("PUT", "/api/admin/settings", { name: "  Kava   Boards ", attentionMinutes: 9999, customPresets: [{ name: "Ours", theme: { accent: "#123456" } }] }, staff);
    const s = ((await r.json()) as { settings: { name: string; attentionMinutes: number; customPresets: { id: string; theme: { accent: string } }[] } }).settings;
    assert.equal(s.name, "Kava Boards");
    assert.equal(s.attentionMinutes, 240);
    assert.equal(s.customPresets[0].theme.accent, "#123456");
    assert.match(s.customPresets[0].id, /^[a-z0-9]{8}$/);
    assert.equal(((await (await t.get("/api/config")).json()) as { gameName: string }).gameName, "Kava Boards");
  });

  test("countdowns are box-only", async () => {
    const r = await t.send("POST", "/api/countdown", { label: "Cornhole starts", minutes: 10 }, staff);
    assert.equal(r.status, 400);
  });
});

describe("live updates and persistence", () => {
  test("a socket following a board gets each change; boards survive a restart", async () => {
    let t = await startApp();
    const staff = await t.staff();
    const v = await t.board(staff, "Live", "points", ["A", "B"]);
    const socket = connect(t.url, { transports: ["websocket"] });
    const seen: BoardView[] = [];
    const lists: BoardSummary[][] = [];
    socket.on("board", (bv: BoardView) => seen.push(bv));
    socket.on("boards", (l: BoardSummary[]) => lists.push(l));
    await new Promise<void>((r) => socket.emit("watch", { boards: [v.board.id], list: true }, () => r()));
    await until(() => seen.length === 1 && lists.length === 1);
    await t.act(staff, v.board.id, { type: "score", pid: v.board.participants[0].id, roundId: "r1", value: 4 });
    await until(() => seen.length === 2);
    assert.equal(seen[1].derived.standings[0].value, 4);
    assert.equal(seen[1].board.lastChange?.type, "score");
    await until(() => lists.length === 2);
    socket.close();

    const dir = t.dataDir;
    await t.stop(true);
    t = await startApp({ dataDir: dir });
    const back = (await (await t.get(`/api/boards/${v.board.id}`)).json()) as BoardView;
    assert.equal(back.derived.standings[0].value, 4);
    await t.stop();
  });
});
