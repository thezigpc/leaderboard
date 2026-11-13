// HTTP helpers. Paths are written from the root ("/api/...") and go through bgUrl, which adds
// the prefix the page runs under on a box or behind a proxy ("/leaderboard/api/...").
//
// Two kinds of sign-in, both kept in this browser (keys prefixed: every app shares the
// venue's address): the staff session (the kit's admin token) and scorekeeper tokens, one per
// board whose PIN was entered, and the host token (the venue's host PIN, for starting boards).

import { bgUrl } from "@bargames/sdk/client";
import type { Action, AdminSettings, AdminSettingsPatch, BoardView, FormatId, PeopleSeen, TvSettings, WhoAmI } from "@leaderboard/shared";

const TOKEN_KEY = "leaderboard_adminToken";
const SCORERS_KEY = "leaderboard_scorers";
const HOST_KEY = "leaderboard_hostToken";

const storage = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* storage blocked: signed in until reload */
    }
  },
};

let memToken = "";
export const getToken = (): string => storage.get(TOKEN_KEY) || memToken;
export function setToken(token: string): void {
  memToken = token;
  storage.set(TOKEN_KEY, token);
}

let memHost = "";
export const getHostToken = (): string => storage.get(HOST_KEY) || memHost;
export function setHostToken(token: string): void {
  memHost = token;
  storage.set(HOST_KEY, token);
}

let memScorers: Record<string, string> = {};
export function scorerTokens(): Record<string, string> {
  try {
    const v = JSON.parse(storage.get(SCORERS_KEY) || "{}") as Record<string, string>;
    return { ...memScorers, ...v };
  } catch {
    return memScorers;
  }
}
export function setScorerToken(boardId: string, token: string | null): void {
  const all = scorerTokens();
  if (token) all[boardId] = token;
  else delete all[boardId];
  memScorers = all;
  storage.set(SCORERS_KEY, Object.keys(all).length ? JSON.stringify(all) : "");
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get code(): string | undefined {
    return typeof this.body.code === "string" ? this.body.code : undefined;
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getToken();
  if (token) h.authorization = `Bearer ${token}`;
  const scorers = Object.values(scorerTokens());
  if (scorers.length) h["x-scorer"] = scorers.join(" ");
  const host = getHostToken();
  if (host) h["x-host"] = host;
  return h;
}

export async function request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders(), ...extra };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(bgUrl(path), { method, headers, body: payload, cache: "no-store" });
  } catch {
    throw new ApiError("Can't reach the server. Check the connection and try again.", 0);
  }
  const json = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
  if (!res.ok) throw new ApiError(json?.error ?? `The server answered ${res.status}.`, res.status, json ?? {});
  return json as T;
}

export interface AuthStatus {
  setupNeeded: boolean;
  configured: boolean;
  broken: boolean;
  authenticated: boolean;
  minPasswordLength: number;
  venueLogin?: boolean;
  setupAllowed?: boolean;
}

export type BoardResponse = BoardView & { canUndo?: boolean };
/** A board a host (not staff) started: they score it, and it has a PIN for a second phone. */
export type CreatedBoard = BoardView & { scorer?: { token: string; pin: string } };

export const api = {
  status: () => request<AuthStatus>("GET", "/api/admin/status"),
  setup: (password: string) => request<{ token: string }>("POST", "/api/admin/setup", { password }),
  login: (password: string) => request<{ token: string }>("POST", "/api/admin/login", { password }),
  logout: () => request("POST", "/api/admin/logout", {}),
  me: () => request<WhoAmI>("GET", "/api/me"),
  board: (id: string) => request<BoardResponse>("GET", `/api/boards/${encodeURIComponent(id)}`),
  create: (body: {
    title: string;
    format: FormatId;
    preset?: string;
    copyFrom?: string;
    keepEntrants?: boolean;
    seedFrom?: { boardId: string; top: number };
    entry?: { kind: "players" | "teams"; size: number };
  }) => request<CreatedBoard>("POST", "/api/boards", body),
  hostLogin: (pin: string) => request<{ token: string }>("POST", "/api/host-login", { pin }),
  people: (exclude?: string) => request<PeopleSeen>("GET", `/api/people${exclude ? `?exclude=${encodeURIComponent(exclude)}` : ""}`),
  act: (id: string, version: number, action: Action) => request<BoardView>("POST", `/api/boards/${encodeURIComponent(id)}/actions`, { version, action }),
  undo: (id: string, version: number) => request<BoardView>("POST", `/api/boards/${encodeURIComponent(id)}/undo`, { version }),
  remove: (id: string) => request("DELETE", `/api/boards/${encodeURIComponent(id)}`),
  setPin: (id: string, pin: string | null) => request<BoardView>("PUT", `/api/boards/${encodeURIComponent(id)}/pin`, { pin }),
  pinLogin: (id: string, pin: string) => request<{ token: string }>("POST", `/api/boards/${encodeURIComponent(id)}/pin-login`, { pin }),
  setTv: (tv: Partial<TvSettings>) => request<{ tv: TvSettings }>("PUT", "/api/tv", tv),
  countdown: (label: string, minutes: number) => request("POST", "/api/countdown", { label, minutes }),
  clearCountdown: () => request("DELETE", "/api/countdown"),
  upload: (file: File) => request<{ file: string }>("POST", "/api/uploads", file, { "content-type": file.type || "application/octet-stream" }),
  settings: () => request<AdminSettings>("GET", "/api/admin/settings"),
  saveSettings: (s: AdminSettingsPatch) => request<{ settings: AdminSettings }>("PUT", "/api/admin/settings", s),
};

export const csvUrl = (id: string) => bgUrl(`/api/boards/${encodeURIComponent(id)}/export.csv`);
export const uploadUrl = (file: string) => bgUrl(`/uploads/${file}`);
