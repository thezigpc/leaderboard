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
  /** Standalone display name ("" = GAME_NAME or "Leaderboard"). */
  name: string;
  tv: TvSettings;
  /** A called match with no result after this many minutes asks staff to look (0 = never). */
  attentionMinutes: number;
  customPresets: CustomPreset[];
}

export interface PublicConfig {
  gameName: string;
  /** Build id of the client the server is serving: a TV left on for days reloads when it changes. */
  build: string;
  onBox: boolean;
}

/** Who is asking: venue staff (every board) or a scorekeeper with one board's PIN. */
export interface WhoAmI {
  staff: boolean;
  /** Boards this browser may score (staff: all). */
  boards: string[];
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
};
