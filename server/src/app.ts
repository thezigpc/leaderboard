// The HTTP app and the live socket. Built by a function so tests can run it in-process with
// their own data dir and a fake box.
//
// Reads are public (the TV and the players' phones). Changes need staff (signed in to /admin,
// or to the venue box) or, for one board, its scorekeeper PIN. Every change carries the board's
// version; the server applies it with the format's rules, saves, and pushes the new state to
// every screen following that board.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server as IoServer } from "socket.io";
import type { BarGames } from "@bargames/sdk/server";
import {
  adminRouter,
  bearerToken,
  createAdminAuth,
  createJsonStore,
  createSettingStore,
  log,
  serveSpa,
  SOCKET_SERVER_OPTIONS,
  type AdminAuth,
} from "@bargames/gamekit/server";
import {
  boardCsv,
  cleanName,
  DEFAULT_APP_SETTINGS,
  DEFAULT_NAME,
  mergeTheme,
  peopleSeen,
  presetTheme,
  SERVER_ACTIONS,
  type Action,
  type AdminSettings,
  type AdminSettingsPatch,
  type AppSettings,
  type ClientToServerEvents,
  type CustomPreset,
  type FormatId,
  type PublicConfig,
  type ServerToClientEvents,
  type TvSettings,
  type WatchArgs,
  type WhoAmI,
} from "@leaderboard/shared";
import { announceChange, attentionReporter, waitingTooLong } from "./bargames.js";
import { BoardService, newId, validBoardId, type ApplyOutcome } from "./boards.js";
import { MatchLinks } from "./matches.js";
import { hashPin, randomPin, Scorers, validPin } from "./scorers.js";
import { MAX_UPLOAD_MB, Uploads } from "./uploads.js";

export interface AppOptions {
  dataDir: string;
  bg: BarGames;
  adminPassword?: string;
  /** GAME_NAME env (standalone default name). */
  gameName?: string;
  clientDist?: string;
  /** Path prefix (SDK 0.10.0), e.g. "/leaderboard". Default: bg.basePath. */
  basePath?: string;
  now?: () => number;
  /** How often to look for matches waiting too long (ms). */
  attentionEveryMs?: number;
  /** How often to ask the box about matches being played in its games (ms). */
  matchPollMs?: number;
}

export interface LeaderboardApp {
  app: express.Express;
  boards: BoardService;
  matches: MatchLinks;
  auth: AdminAuth;
  /** Attaches socket.io to the HTTP server. */
  attach(server: HttpServer): IoServer;
  close(): Promise<void>;
}

/** Async route errors go to Express instead of becoming unhandled rejections. */
const safe =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    void Promise.resolve(fn(req, res)).catch(next);

const FORMATS: FormatId[] = ["points", "single", "double", "roundrobin", "ladder", "best"];

function normalizeTv(v: Partial<TvSettings> | undefined, cur: TvSettings = DEFAULT_APP_SETTINGS.tv): TvSettings {
  const o = { ...cur, ...(v ?? {}) };
  const ids = Array.isArray(o.boardIds) ? o.boardIds.filter(validBoardId).slice(0, 20) : [];
  return {
    mode: o.mode === "board" || o.mode === "rotate" ? o.mode : "auto",
    boardId: validBoardId(o.boardId) ? o.boardId : undefined,
    boardIds: [...new Set(ids)],
    rotateSeconds: Math.min(300, Math.max(5, Math.round(Number(o.rotateSeconds) || 20))),
    showQr: typeof o.showQr === "boolean" ? o.showQr : true,
  };
}

function normalizeSettings(s: AppSettings): AppSettings {
  const presets: CustomPreset[] = (Array.isArray(s.customPresets) ? s.customPresets : [])
    .filter((p) => p && typeof p.id === "string" && /^[a-z0-9]{4,20}$/.test(p.id))
    .slice(0, 30)
    .map((p) => ({ id: p.id, name: cleanName(p.name, 30) || "My preset", theme: mergeTheme(presetTheme("classic"), p.theme) }));
  return {
    name: cleanName(s.name, 60),
    tv: normalizeTv(s.tv),
    attentionMinutes: Math.min(240, Math.max(0, Math.round(Number(s.attentionMinutes) || 0))),
    customPresets: presets,
    newBoards: s.newBoards === "pin" || s.newBoards === "open" ? s.newBoards : "staff",
    hostPin:
      s.hostPin && typeof s.hostPin.hash === "string" && typeof s.hostPin.salt === "string" ? { hash: s.hostPin.hash, salt: s.hostPin.salt } : undefined,
  };
}

/** Settings for the admin page: never the host PIN's hash. */
function adminView(s: AppSettings): AdminSettings {
  const { hostPin, ...rest } = s;
  return { ...rest, hostPinSet: !!hostPin };
}

/** Boards one device (not staff) may start per hour. */
const HOST_CREATES_PER_HOUR = 12;

export async function createApp(o: AppOptions): Promise<LeaderboardApp> {
  const bg = o.bg;
  const now = o.now ?? Date.now;
  const store = createJsonStore(o.dataDir);
  const boards = new BoardService(store, now);
  await boards.init();
  const scorers = new Scorers(store, now);
  await scorers.init();
  const uploads = new Uploads(o.dataDir);
  const settings = createSettingStore<AppSettings>({ store, file: "settings.json", defaults: DEFAULT_APP_SETTINGS, normalize: normalizeSettings });
  await settings.init();

  const auth = createAdminAuth({
    store,
    envPassword: o.adminPassword ?? "",
    saltFormat: "bytes",
    // Standalone behind Cloudflare a whole venue's Wi-Fi shares one public IP, so a per-IP
    // lockout would let any guest lock the staff out; the kit's global cap and delay still
    // slow guessing. On a box each device has its own address.
    failsAllowed: bg.connected ? undefined : Number.POSITIVE_INFINITY,
    // On a box the venue box's admin password also opens this admin (SDK 0.8.0), and it takes
    // over (kit 0.5.1): no first-run setup unless the box vouches for staff.
    venuePassword: (pw, ip) => bg.checkVenuePassword(pw, ip),
    onBox: bg.connected,
  });
  await auth.init();

  // The client build the server is serving: a TV left on for days reloads when it changes.
  const indexHtml = o.clientDist ? path.join(o.clientDist, "index.html") : "";
  const hasClient = !!indexHtml && existsSync(indexHtml);
  const build = hasClient ? createHash("sha1").update(readFileSync(indexHtml)).digest("hex").slice(0, 12) : "dev";

  async function displayName(): Promise<string> {
    if (bg.connected) {
      try {
        return (await bg.venue()).game.displayName;
      } catch {
        /* fall through to the standalone name */
      }
    }
    return settings.get().name || o.gameName || DEFAULT_NAME;
  }

  // ----------------------------------------------------------------- who may change what
  const isStaff = (req: Request) => auth.isValidSession(bearerToken(req));
  const scorerBoards = (req: Request): string[] => {
    const raw = String(req.get("x-scorer") ?? "");
    return raw
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 20)
      .map((t) => scorers.verify(t, (id) => boards.get(id)))
      .filter((x): x is string => !!x);
  };
  const canScore = (req: Request, id: string) => isStaff(req) || scorerBoards(req).includes(id);
  // Who may start a board: staff; anyone, when the venue allows it; or a host who typed the
  // host PIN ("pin" without a PIN set means staff only).
  const newBoards = (): AppSettings["newBoards"] => {
    const s = settings.get();
    return s.newBoards === "pin" && !s.hostPin ? "staff" : s.newBoards;
  };
  const isHost = (req: Request) => {
    const mode = newBoards();
    return mode === "open" || (mode === "pin" && scorers.verifyHost(String(req.get("x-host") ?? ""), settings.get().hostPin));
  };
  const canCreate = (req: Request) => isStaff(req) || isHost(req);
  const hostCreates = new Map<string, number[]>();

  // ----------------------------------------------------------------- live updates
  let io: IoServer<ClientToServerEvents, ServerToClientEvents> | undefined;
  let listTimer: NodeJS.Timeout | undefined;
  const pushBoard = (id: string) => {
    const b = boards.get(id);
    if (b && io) io.to(`board:${id}`).emit("board", boards.view(b));
  };
  const pushList = () => {
    if (!io || listTimer) return;
    // Several changes in a burst send one list.
    listTimer = setTimeout(() => {
      listTimer = undefined;
      io?.to("list").emit("boards", boards.summaries());
    }, 150);
  };
  const reportAttention = attentionReporter(bg);
  const checkAttention = () => {
    const live = boards.all().filter((b) => b.status === "live");
    reportAttention(waitingTooLong(live.map((b) => ({ board: b, derived: boards.derived(b) })), settings.get().attentionMinutes, now()));
  };
  boards.onChange = (e) => {
    pushBoard(e.after.board.id);
    pushList();
    announceChange(bg, e.before, e.after, e.action);
    checkAttention();
  };
  boards.onRefresh = (id) => {
    pushBoard(id);
    pushList();
  };
  boards.onRemove = (id) => {
    io?.to(`board:${id}`).emit("removed", { id });
    pushList();
  };
  const attentionTimer = setInterval(checkAttention, o.attentionEveryMs ?? 60_000);
  attentionTimer.unref();

  // Bracket matches played in games on the box (SDK 0.15.0). Registers "match_result".
  const matches = new MatchLinks(bg, boards, now);
  if (bg.connected) matches.every(o.matchPollMs ?? 3 * 60_000);

  // ----------------------------------------------------------------- routes
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  // Bar Games: /__bargames/* (venue.json, theme.css, status). Before the SPA catch-all.
  app.use(bg.middleware());

  app.get("/health", (_req, res) => void res.json({ ok: true, boards: boards.all().length }));

  app.get(
    "/api/config",
    safe(async (_req, res) => {
      res.set("Cache-Control", "no-cache");
      const body: PublicConfig = { gameName: await displayName(), build, onBox: bg.connected, newBoards: newBoards() };
      res.json(body);
    }),
  );

  const json = express.json({ limit: "256kb" });

  app.get("/api/boards", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json(boards.summaries());
  });

  app.get("/api/boards/:id", (req, res) => {
    const b = boards.get(req.params.id);
    if (!b) return void res.status(404).json({ ok: false, error: "That board is gone." });
    res.set("Cache-Control", "no-cache");
    res.json({ ...boards.view(b), canUndo: boards.canUndo(b.id) });
  });

  app.get("/api/boards/:id/export.csv", (req, res) => {
    const b = boards.get(req.params.id);
    if (!b) return void res.status(404).json({ ok: false, error: "That board is gone." });
    const file = `${b.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "board"}.csv`;
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${file}"`);
    res.send("﻿" + boardCsv(boards.effective(b), boards.derived(b)));
  });

  app.get("/api/tv", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json(settings.get().tv);
  });

  app.get("/api/me", (req, res) => {
    const staff = isStaff(req);
    const body: WhoAmI = { staff, boards: staff ? boards.all().map((b) => b.id) : scorerBoards(req), canCreate: staff || isHost(req) };
    res.json(body);
  });

  // Regulars from earlier boards (names only), for the host's "who's here tonight" and the
  // quick-add suggestions. Scorekeepers only: it's a list of everyone who has played.
  app.get("/api/people", (req, res) => {
    if (!isStaff(req) && !scorerBoards(req).length) return void res.status(401).json({ ok: false, error: "Sign in first." });
    const exclude = typeof req.query.exclude === "string" ? req.query.exclude : undefined;
    res.set("Cache-Control", "no-store");
    res.json(peopleSeen(boards.all(), exclude));
  });

  const send = (res: Response, r: ApplyOutcome) => {
    if (r.ok) return void res.json({ ok: true, ...r.view });
    res.status(r.status).json({ ok: false, error: r.error, code: r.code, affected: r.affected, view: r.view });
  };

  app.post(
    "/api/boards",
    json,
    safe(async (req, res) => {
      const staff = isStaff(req);
      if (!staff && !canCreate(req))
        return void res.status(401).json({ ok: false, error: newBoards() === "pin" ? "Enter the host PIN first." : "Staff only. Sign in first." });
      let ip = "";
      if (!staff) {
        ip = bg.clientIp(req);
        const recent = (hostCreates.get(ip) ?? []).filter((t) => t > now() - 3600_000);
        if (recent.length >= HOST_CREATES_PER_HOUR) return void res.status(429).json({ ok: false, error: "That's a lot of new boards. Wait a while, or ask staff." });
        hostCreates.set(ip, [...recent, now()]);
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const format = FORMATS.includes(body.format as FormatId) ? (body.format as FormatId) : "points";
      const seedFrom = body.seedFrom && typeof body.seedFrom === "object" ? (body.seedFrom as { boardId: string; top: number }) : undefined;
      const made = await boards.create({
          title: typeof body.title === "string" ? body.title : "",
          format,
          preset: typeof body.preset === "string" ? body.preset : undefined,
          copyFrom: validBoardId(body.copyFrom) ? body.copyFrom : undefined,
          keepEntrants: body.keepEntrants === true,
          season: body.season === true,
          seedFrom: seedFrom && validBoardId(seedFrom.boardId) ? seedFrom : undefined,
          entry:
            body.entry && typeof body.entry === "object"
              ? { kind: (body.entry as { kind?: unknown }).kind === "teams" ? "teams" : "players", size: Number((body.entry as { size?: unknown }).size) || 0 }
              : undefined,
      });
      if (!made.ok || staff) return send(res, made);
      // A host who isn't staff keeps score on the board they started: it gets a PIN (so a
      // second phone can join), and this phone gets that board's scorekeeper token.
      const pin = randomPin();
      const withPin = await boards.setPin(made.view.board.id, await hashPin(pin));
      if (!withPin.ok) return send(res, withPin);
      const b = boards.get(made.view.board.id)!;
      log.info("boards", "board started by a host", { board: b.id });
      res.json({ ok: true, ...withPin.view, scorer: { token: scorers.issue(b), pin } });
    }),
  );

  app.post(
    "/api/host-login",
    json,
    safe(async (req, res) => {
      if (newBoards() !== "pin") return void res.status(400).json({ ok: false, error: newBoards() === "open" ? "No PIN needed: anyone can start a board." : "Only staff can start boards here." });
      const r = await scorers.hostLogin(settings.get().hostPin, (req.body ?? {}).pin, bg.clientIp(req));
      if (!r.ok) return void res.status(r.status).json({ ok: false, error: r.error });
      log.info("scorers", "host signed in");
      res.json({ ok: true, token: r.token });
    }),
  );

  app.post(
    "/api/boards/:id/actions",
    json,
    safe(async (req, res) => {
      const id = req.params.id;
      if (!boards.get(id)) return void res.status(404).json({ ok: false, error: "That board is gone." });
      if (!canScore(req, id)) return void res.status(401).json({ ok: false, error: "Sign in, or enter this board's PIN, to keep score." });
      const { version, action } = (req.body ?? {}) as { version?: unknown; action?: Action };
      if (!action || typeof action !== "object") return void res.status(400).json({ ok: false, error: "No change was sent." });
      if (SERVER_ACTIONS.includes(action.type)) return void res.status(400).json({ ok: false, error: "That change comes from the box, not a phone." });
      send(res, await boards.apply(id, version, action));
    }),
  );

  // Games on the box that can play a match (empty off a box). Scorekeepers only.
  app.get(
    "/api/match-games",
    safe(async (req, res) => {
      if (!isStaff(req) && !scorerBoards(req).length) return void res.status(401).json({ ok: false, error: "Sign in first." });
      res.set("Cache-Control", "no-store");
      res.json({ games: (await matches.games()).map((g) => ({ id: g.id, name: g.name })) });
    }),
  );

  // "Play in Pool": the box makes a room for this match in that game.
  app.post(
    "/api/boards/:id/matches/:matchId/play",
    json,
    safe(async (req, res) => {
      const id = req.params.id;
      if (!boards.get(id)) return void res.status(404).json({ ok: false, error: "That board is gone." });
      if (!canScore(req, id)) return void res.status(401).json({ ok: false, error: "Sign in, or enter this board's PIN, to keep score." });
      if (!bg.connected) return void res.status(400).json({ ok: false, error: "Matches play in other games on a Bar Games box only." });
      const gameId = (req.body ?? {}).gameId;
      if (typeof gameId !== "string" || !gameId) return void res.status(400).json({ ok: false, error: "Pick a game." });
      send(res, await matches.start(id, String(req.params.matchId).slice(0, 40), gameId));
    }),
  );

  app.post(
    "/api/boards/:id/undo",
    json,
    safe(async (req, res) => {
      const id = req.params.id;
      if (!boards.get(id)) return void res.status(404).json({ ok: false, error: "That board is gone." });
      if (!canScore(req, id)) return void res.status(401).json({ ok: false, error: "Sign in, or enter this board's PIN, to keep score." });
      send(res, await boards.undoLast(id, (req.body ?? {}).version));
    }),
  );

  app.delete(
    "/api/boards/:id",
    safe(async (req, res) => {
      if (!isStaff(req)) return void res.status(401).json({ ok: false, error: "Staff only." });
      if (!(await boards.remove(req.params.id))) return void res.status(404).json({ ok: false, error: "That board is already gone." });
      res.json({ ok: true });
    }),
  );

  app.put(
    "/api/boards/:id/pin",
    json,
    safe(async (req, res) => {
      if (!isStaff(req)) return void res.status(401).json({ ok: false, error: "Staff only." });
      const pin = (req.body ?? {}).pin;
      if (pin !== null && !validPin(pin)) return void res.status(400).json({ ok: false, error: "A PIN is 4 to 8 digits." });
      send(res, await boards.setPin(req.params.id, pin === null ? null : await hashPin(pin)));
    }),
  );

  app.post(
    "/api/boards/:id/pin-login",
    json,
    safe(async (req, res) => {
      const b = boards.get(req.params.id);
      if (!b) return void res.status(404).json({ ok: false, error: "That board is gone." });
      const r = await scorers.login(b, (req.body ?? {}).pin, bg.clientIp(req));
      if (!r.ok) return void res.status(r.status).json({ ok: false, error: r.error });
      log.info("scorers", "scorekeeper signed in", { board: b.id });
      res.json({ ok: true, token: r.token, boardId: b.id });
    }),
  );

  app.put(
    "/api/tv",
    json,
    safe(async (req, res) => {
      const next = normalizeTv(req.body, settings.get().tv);
      if (!isStaff(req)) {
        // A scorekeeper can put their own board on the TVs, nothing else.
        const mine = scorerBoards(req);
        if (!(next.mode === "board" && next.boardId && mine.includes(next.boardId)))
          return void res.status(401).json({ ok: false, error: "Only staff can change the TVs, except to show your own board." });
      }
      const saved = await settings.set({ tv: next });
      io?.to("tv").emit("tv", saved.tv);
      res.json({ ok: true, tv: saved.tv });
    }),
  );

  app.post(
    "/api/countdown",
    json,
    safe(async (req, res) => {
      if (!isStaff(req) && !scorerBoards(req).length) return void res.status(401).json({ ok: false, error: "Sign in to start a countdown." });
      if (!bg.connected) return void res.status(400).json({ ok: false, error: "Countdowns show on a Bar Games box only." });
      const label = cleanName((req.body ?? {}).label, 60);
      const minutes = Math.round(Number((req.body ?? {}).minutes));
      if (!label) return void res.status(400).json({ ok: false, error: "Say what's starting." });
      if (!(minutes >= 1 && minutes <= 180)) return void res.status(400).json({ ok: false, error: "1 to 180 minutes." });
      const c = await bg.startCountdown({ label, minutes });
      res.json({ ok: true, countdown: c ?? null });
    }),
  );

  app.delete(
    "/api/countdown",
    safe(async (req, res) => {
      if (!isStaff(req) && !scorerBoards(req).length) return void res.status(401).json({ ok: false, error: "Sign in first." });
      await bg.clearCountdown();
      res.json({ ok: true });
    }),
  );

  const rawImage = express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` });
  app.post(
    "/api/uploads",
    (req, res, next) => {
      if (!isStaff(req) && !scorerBoards(req).length) return void res.status(401).json({ ok: false, error: "Sign in to upload images." });
      rawImage(req, res, (err?: unknown) => {
        if (!err) return next();
        const tooBig = (err as { type?: string }).type === "entity.too.large";
        res.status(tooBig ? 413 : 400).json({ ok: false, error: tooBig ? `Images can be up to ${MAX_UPLOAD_MB} MB.` : "The upload didn't arrive in one piece." });
      });
    },
    safe(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ ok: false, error: "No image in the upload." });
      const r = await uploads.save(req.body);
      res.status(r.ok ? 200 : 400).json(r);
    }),
  );

  app.use(
    "/uploads",
    express.static(uploads.dir, {
      immutable: true,
      maxAge: "365d",
      index: false,
      dotfiles: "ignore",
      fallthrough: false,
      setHeaders: (res) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Content-Security-Policy", "default-src 'none'");
      },
    }),
  );

  // ----------------------------------------------------------------- admin
  // Staff signed in to the venue box's admin get a session without the password (SDK 0.7.0).
  // isStaff trusts the gateway's headers only on a box, so standalone it's always false.
  const admin = adminRouter({ auth, clientIp: (req) => bg.clientIp(req), trusted: (req) => bg.isStaff(req) });
  admin.get("/settings", (_req, res) => void res.json(adminView(settings.get())));
  admin.put(
    "/settings",
    safe(async (req, res) => {
      const cur = settings.get();
      const body = (req.body ?? {}) as AdminSettingsPatch;
      let hostPin = cur.hostPin;
      if (body.hostPin === null) hostPin = undefined;
      else if (body.hostPin !== undefined) {
        if (!validPin(body.hostPin)) return void res.status(400).json({ ok: false, error: "A PIN is 4 to 8 digits." });
        hostPin = await hashPin(body.hostPin);
      }
      const presets = Array.isArray(body.customPresets)
        ? body.customPresets.map((p) => ({ ...p, id: typeof p?.id === "string" && /^[a-z0-9]{4,20}$/.test(p.id) ? p.id : newId(8) }))
        : cur.customPresets;
      const saved = await settings.set({ ...cur, ...body, tv: normalizeTv(body.tv, cur.tv), customPresets: presets, hostPin });
      io?.to("tv").emit("tv", saved.tv);
      log.info("admin", "settings saved");
      res.json({ ok: true, settings: adminView(saved) });
    }),
  );
  app.use("/api/admin", json, admin);
  app.use("/api", (_req, res) => void res.status(404).json({ ok: false, error: "Not found." }));

  // ----------------------------------------------------------------- client
  if (hasClient && o.clientDist) {
    // index.html gets the prefix injected (<meta name="bargames-base"> + <base href>), so the
    // client finds "/leaderboard/api/..." behind a proxy that strips "/leaderboard".
    serveSpa(app, { dist: o.clientDist, basePath: o.basePath ?? bg.basePath });
  } else {
    log.warn("boot", "client build not found; serving the API only", { path: o.clientDist });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) log.error("http", "request failed", { err: String(err) });
    if (!res.headersSent) res.status(status).json({ ok: false, error: status === 404 ? "Not found." : status === 400 ? "That request didn't make sense." : "Something went wrong." });
  });

  function attach(server: HttpServer): IoServer {
    io = new IoServer<ClientToServerEvents, ServerToClientEvents>(server, { ...SOCKET_SERVER_OPTIONS, maxHttpBufferSize: 16 * 1024 });
    io.on("connection", (socket) => {
      socket.on("watch", (args: WatchArgs, ack) => {
        const a = (args ?? {}) as WatchArgs;
        for (const room of socket.rooms) if (room !== socket.id) void socket.leave(room);
        const ids = Array.isArray(a.boards) ? [...new Set(a.boards.filter(validBoardId))].slice(0, 30) : [];
        for (const id of ids) {
          void socket.join(`board:${id}`);
          const b = boards.get(id);
          if (b) socket.emit("board", boards.view(b));
          else socket.emit("removed", { id });
        }
        if (a.list) {
          void socket.join("list");
          socket.emit("boards", boards.summaries());
        }
        if (a.tv) {
          void socket.join("tv");
          socket.emit("tv", settings.get().tv);
        }
        if (typeof ack === "function") ack({ ok: true });
      });
    });
    return io;
  }

  return {
    app,
    boards,
    matches,
    auth,
    attach,
    async close() {
      clearInterval(attentionTimer);
      matches.close();
      if (listTimer) clearTimeout(listTimer);
      auth.close();
      await boards.flush();
      await new Promise<void>((r) => (io ? io.close(() => r()) : r()));
    },
  };
}
