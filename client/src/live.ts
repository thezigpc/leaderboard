// Live state: one socket.io connection per page, following the boards a screen shows.
// The server pushes a board's whole view on every change. If the socket is down for a while
// (a TV through a network blip), the hooks fall back to fetching over HTTP every 15 s, and
// the socket reconnects by itself.

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_OPTIONS, socketPath, usePublicConfig } from "@bargames/gamekit/client";
import { basePath, bgUrl } from "@bargames/sdk/client";
import { DEFAULT_NAME, DEFAULT_TV, type BoardSummary, type BoardView, type ClientToServerEvents, type PublicConfig, type ServerToClientEvents, type TvSettings, type WatchArgs } from "@leaderboard/shared";

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
let socket: S | undefined;

export function getSocket(): S {
  // Same origin (Vite proxies in dev); under a prefix the path is /leaderboard/socket.io.
  socket ??= io({ ...SOCKET_OPTIONS, path: socketPath() }) as S;
  return socket;
}

/** Everything this page wants to follow, merged from every hook that's mounted. */
const wants = new Map<number, WatchArgs>();
let nextKey = 1;
function rewatch() {
  const s = getSocket();
  const boards = new Set<string>();
  let list = false;
  let tv = false;
  for (const w of wants.values()) {
    w.boards?.forEach((b) => boards.add(b));
    list ||= !!w.list;
    tv ||= !!w.tv;
  }
  if (s.connected) s.emit("watch", { boards: [...boards], list, tv });
}
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  getSocket().on("connect", rewatch);
}

function useWatch(args: WatchArgs, key: string) {
  useEffect(() => {
    wire();
    const k = nextKey++;
    wants.set(k, args);
    rewatch();
    return () => {
      wants.delete(k);
      rewatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** True while the socket is connected. */
export function useConnected(): boolean {
  const s = getSocket();
  const [on, setOn] = useState(s.connected);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    s.on("connect", up);
    s.on("disconnect", down);
    setOn(s.connected);
    return () => {
      s.off("connect", up);
      s.off("disconnect", down);
    };
  }, [s]);
  return on;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(bgUrl(path), { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Polls over HTTP while the socket is down. */
function usePollWhileDown(fn: () => void, ms = 15_000) {
  const connected = useConnected();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [connected, ms]);
}

export type BoardState = { status: "loading" } | { status: "gone" } | { status: "ready"; view: BoardView };

/** Follows several boards. */
export function useBoards(ids: string[]): Map<string, BoardState> {
  const key = [...ids].sort().join(",");
  const [state, setState] = useState(() => new Map<string, BoardState>(ids.map((id) => [id, { status: "loading" }])));
  useWatch({ boards: ids }, key);
  useEffect(() => {
    const s = getSocket();
    const want = new Set(ids);
    const onBoard = (v: BoardView) => {
      if (!want.has(v.board.id)) return;
      setState((m) => {
        const cur = m.get(v.board.id);
        // Never go back to an older version (an HTTP answer racing a push).
        if (cur?.status === "ready" && cur.view.board.version > v.board.version) return m;
        return new Map(m).set(v.board.id, { status: "ready", view: v });
      });
    };
    const onRemoved = ({ id }: { id: string }) => want.has(id) && setState((m) => new Map(m).set(id, { status: "gone" }));
    s.on("board", onBoard);
    s.on("removed", onRemoved);
    for (const id of ids)
      void getJson<BoardView>(`/api/boards/${encodeURIComponent(id)}`).then((v) => (v ? onBoard(v) : setState((m) => (m.get(id)?.status === "ready" ? m : new Map(m).set(id, { status: "gone" })))));
    return () => {
      s.off("board", onBoard);
      s.off("removed", onRemoved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  usePollWhileDown(() => {
    for (const id of ids)
      void getJson<BoardView>(`/api/boards/${encodeURIComponent(id)}`).then(
        (v) => v && setState((m) => new Map(m).set(id, { status: "ready", view: v })),
      );
  });
  return state;
}

export function useBoard(id: string | undefined): BoardState & { set?: (v: BoardView) => void } {
  const all = useBoards(id ? [id] : []);
  const [local, setLocal] = useState<BoardView | null>(null);
  const s = id ? all.get(id) ?? { status: "loading" as const } : { status: "gone" as const };
  // A view from our own change's response can be newer than the last push for a moment.
  if (local && local.board.id === id && (s.status !== "ready" || s.view.board.version < local.board.version)) return { status: "ready", view: local, set: setLocal };
  return { ...s, set: setLocal };
}

/** The list of boards (summaries), live. */
export function useBoardList(): BoardSummary[] | null {
  const [list, setList] = useState<BoardSummary[] | null>(null);
  useWatch({ list: true }, "list");
  useEffect(() => {
    const s = getSocket();
    const on = (l: BoardSummary[]) => setList(l);
    s.on("boards", on);
    void getJson<BoardSummary[]>("/api/boards").then((l) => l && setList((cur) => cur ?? l));
    return () => void s.off("boards", on);
  }, []);
  usePollWhileDown(() => void getJson<BoardSummary[]>("/api/boards").then((l) => l && setList(l)));
  return list;
}

/** What the TVs show, live. */
export function useTvSettings(): TvSettings | null {
  const [tv, setTv] = useState<TvSettings | null>(null);
  useWatch({ tv: true }, "tv");
  useEffect(() => {
    const s = getSocket();
    const on = (t: TvSettings) => setTv(t);
    s.on("tv", on);
    void getJson<TvSettings>("/api/tv").then((t) => setTv((cur) => cur ?? t ?? DEFAULT_TV));
    return () => void s.off("tv", on);
  }, []);
  usePollWhileDown(() => void getJson<TvSettings>("/api/tv").then((t) => t && setTv(t)));
  return tv;
}

const parseConfig = (raw: unknown): PublicConfig => {
  const o = (raw ?? {}) as Partial<PublicConfig>;
  return {
    gameName: typeof o.gameName === "string" && o.gameName ? o.gameName : DEFAULT_NAME,
    build: String(o.build ?? ""),
    onBox: !!o.onBox,
    newBoards: o.newBoards === "pin" || o.newBoards === "open" ? o.newBoards : "staff",
  };
};

/** /api/config, fetched once and shared (the kit's cache). */
export function useConfig(): PublicConfig | null {
  return usePublicConfig(basePath(), parseConfig);
}
