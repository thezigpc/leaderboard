// What travels between the server and the pages: HTTP bodies and socket events.

import type { Board, BoardStatus, DerivedBoard, FormatId, Theme } from "./types.js";

/** A board as the pages see it: the PIN never leaves the server. */
export type PublicBoard = Omit<Board, "pin"> & { hasPin: boolean };

export interface BoardView {
  board: PublicBoard;
  derived: DerivedBoard;
}

export interface BoardSummary {
  id: string;
  title: string;
  subtitle: string;
  format: FormatId;
  status: BoardStatus;
  kind: "nightly" | "season";
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  winners?: string[];
  participants: number;
  /** The current leader's name (or the champion), when there is exactly one. */
  leader?: string;
  theme: Theme;
  hasPin: boolean;
  version: number;
}

export interface TvSettings {
  /** "auto": rotate every live board; "board": one board; "rotate": the chosen boards. */
  mode: "auto" | "board" | "rotate";
  boardId?: string;
  boardIds: string[];
  rotateSeconds: number;
  /** The follow-along QR code in the corner. */
  showQr: boolean;
}

export interface CustomPreset {
  id: string;
  name: string;
  theme: Theme;
}

export interface AppSettings {
  /** Standalone display name ("" = GAME_NAME or "Tournament & Leaderboard"). */
  name: string;
  tv: TvSettings;
  /** A called match with no result after this many minutes asks staff to look (0 = never). */
  attentionMinutes: number;
  customPresets: CustomPreset[];
  /** Who may start a new board: staff only, anyone with the host PIN, or anyone. */
  newBoards: NewBoards;
  /** The host PIN (salted scrypt hash). Never sent to a browser. */
  hostPin?: { hash: string; salt: string };
}

export type NewBoards = "staff" | "pin" | "open";

/** The settings as the admin page sees them: the host PIN only as set or not. */
export type AdminSettings = Omit<AppSettings, "hostPin"> & { hostPinSet: boolean };

/** What the admin page sends: the host PIN in plain digits, or null to clear it. */
export type AdminSettingsPatch = Partial<Omit<AppSettings, "hostPin">> & { hostPin?: string | null };

export interface PublicConfig {
  gameName: string;
  /** Build id of the client the server is serving: a TV left on for days reloads when it changes. */
  build: string;
  onBox: boolean;
  /** Who may start a board ("pin" only once a host PIN is set). */
  newBoards: NewBoards;
}

/** Who is asking: venue staff (every board) or a scorekeeper with one board's PIN. */
export interface WhoAmI {
  staff: boolean;
  /** Boards this browser may score (staff: all). */
  boards: string[];
  /** May start a new board (staff, the host PIN, or anyone when the venue allows it). */
  canCreate: boolean;
}

export interface ServerToClientEvents {
  board: (view: BoardView) => void;
  boards: (list: BoardSummary[]) => void;
  removed: (p: { id: string }) => void;
  tv: (tv: TvSettings) => void;
}

export interface WatchArgs {
  /** Board ids to follow. */
  boards?: string[];
  /** Follow the list of boards (summaries). */
  list?: boolean;
  /** Follow the TV settings. */
  tv?: boolean;
}

export interface ClientToServerEvents {
  watch: (args: WatchArgs, ack?: (r: { ok: boolean }) => void) => void;
}

export const DEFAULT_TV: TvSettings = { mode: "auto", boardIds: [], rotateSeconds: 20, showQr: true };

export const DEFAULT_APP_SETTINGS: AppSettings = {
  name: "",
  tv: DEFAULT_TV,
  attentionMinutes: 20,
  customPresets: [],
  newBoards: "staff",
};
