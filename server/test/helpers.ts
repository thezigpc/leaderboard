// Test helpers: the app in-process on a free port with its own data dir, and a fake box core.

import { mkdtempSync, rmSync } from "node:fs";
import http, { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { BoardView } from "@leaderboard/shared";
import { createApp, type LeaderboardApp } from "../src/app.js";
import { makeBarGames } from "../src/bargames.js";

export const TOKEN = "test-token";

export interface TestApp {
  url: string;
  lb: LeaderboardApp;
  dataDir: string;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  send(method: string, path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Sets the admin password up (standalone) and returns staff headers. */
  staff(): Promise<Record<string, string>>;
  /** Creates a board as staff and returns its view. */
  board(staff: Record<string, string>, title: string, format: string, names?: string[]): Promise<BoardView>;
  /** Runs an action at the board's current version; returns the response JSON. */
  act(staff: Record<string, string>, id: string, action: unknown, version?: number): Promise<{ status: number; body: Record<string, unknown> & Partial<BoardView> }>;
  stop(keepData?: boolean): Promise<void>;
}

export async function startApp(opts: { coreUrl?: string; token?: string; gameName?: string; dataDir?: string; attentionEveryMs?: number; now?: () => number } = {}): Promise<TestApp> {
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(os.tmpdir(), "leaderboard-test-"));
  const bg = makeBarGames({ defaultName: opts.gameName || "Leaderboard", coreUrl: opts.coreUrl ?? "", token: opts.token ?? "" });
  const lb = await createApp({ dataDir, bg, gameName: opts.gameName, attentionEveryMs: opts.attentionEveryMs, now: opts.now });
  const server: Server = createServer(lb.app);
  lb.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const t: TestApp = {
    url,
    lb,
    dataDir,
    get: (p, headers = {}) => fetch(url + p, { headers }),
    send: (method, p, body, headers = {}) =>
      fetch(url + p, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === null ? undefined : JSON.stringify(body),
      }),
    async staff() {
      const status = (await (await t.get("/api/admin/status")).json()) as { setupNeeded: boolean };
      const r = status.setupNeeded
        ? await t.send("POST", "/api/admin/setup", { password: "correct horse battery" })
        : await t.send("POST", "/api/admin/login", { password: "correct horse battery" });
      const body = (await r.json()) as { token?: string; error?: string };
      if (!body.token) throw new Error(`sign-in failed: ${body.error}`);
      return { authorization: `Bearer ${body.token}` };
    },
    async board(staff, title, format, names = []) {
      const r = await t.send("POST", "/api/boards", { title, format }, staff);
      let v = (await r.json()) as BoardView;
      if (!v.board) throw new Error(`create failed: ${JSON.stringify(v)}`);
      if (names.length) {
        const a = await t.act(staff, v.board.id, { type: "addParticipants", names: [names.join("\n")] }, v.board.version);
        v = a.body as unknown as BoardView;
      }
      return v;
    },
    async act(staff, id, action, version) {
      let ver = version;
      if (ver === undefined) ver = ((await (await t.get(`/api/boards/${id}`)).json()) as BoardView).board.version;
      const r = await t.send("POST", `/api/boards/${id}/actions`, { version: ver, action }, staff);
      return { status: r.status, body: (await r.json()) as Record<string, unknown> & Partial<BoardView> };
    },
    async stop(keepData = false) {
      await lb.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return t;
}

export interface FakeCore {
  url: string;
  posts: { path: string; body: Record<string, unknown> }[];
  /** Bracket matches the app started (SDK 0.15.0), by match id. */
  matches: Map<string, Record<string, unknown>>;
  close(): Promise<void>;
}

/** A fake box core: venue context, and it records events, results, attention and countdowns. */
export async function fakeCore(): Promise<FakeCore> {
  const posts: FakeCore["posts"] = [];
  const matches: FakeCore["matches"] = new Map();
  const srv = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end();
    if (req.method === "GET" && req.url === "/internal/venue") {
      const theme = { colors: { background: "#0b2a2a", surface: "#12403f", text: "#f2fffd", primary: "#ff4fa3", accent: "#ffd23f" } };
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(
        JSON.stringify({
          protocol: 1,
          venue: { name: "Test Bar", theme, playUrl: "https://play.testbar.example" },
          game: { id: "leaderboard", displayName: "Leaderboard at Test Bar", theme, publicUrl: "https://testbar.example/leaderboard" },
          standalone: false,
          generatedAt: new Date().toISOString(),
        }),
      );
    }
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      posts.push({ path: `${req.method} ${req.url}`, body });
      const one = req.url === "/internal/matches/games" ? null : /^\/internal\/matches\/([^/]+)$/.exec(req.url ?? "");
      if (one && req.method === "GET" && !matches.has(decodeURIComponent(one[1]))) return void res.writeHead(404).end("{}");
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/internal/matches/games") {
        return void res.end(
          JSON.stringify([
            { id: "pool", name: "Pool", players: { min: 2, max: 2 } },
            { id: "trivia", name: "Trivia", players: { min: 3, max: 20 } },
          ]),
        );
      }
      if (req.url === "/internal/matches" && req.method === "POST") {
        const rec = { ...body, appId: "leaderboard", roomCode: `R${matches.size + 1}`, status: "playing", createdAt: new Date().toISOString(), joinUrl: "https://testbar.example/pool/join" };
        matches.set(String(body.matchId), rec);
        return void res.end(JSON.stringify(rec));
      }
      if (one && req.method === "GET") return void res.end(JSON.stringify(matches.get(decodeURIComponent(one[1]))));
      if (req.url === "/internal/venue-password") return void res.end(JSON.stringify({ ok: body.password === "box-password" }));
      if (req.url === "/internal/countdown" && req.method === "POST")
        return void res.end(JSON.stringify({ id: "c1", label: body.label, endsAt: new Date(Date.now() + Number(body.minutes) * 60_000).toISOString() }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
    posts,
    matches,
    close: () => new Promise((r) => srv.close(() => r())),
  };
}

export const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};
