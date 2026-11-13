// Runs the host's changes one after another (each at the board's latest version), and turns
// the server's refusals into something the host can act on:
// - STALE: someone else changed the board; show theirs and say so;
// - REFLOW: a bracket change would clear later results; ask, then send it again with force.

import { useCallback, useRef } from "react";
import type { Action, BoardView } from "@leaderboard/shared";
import { api, ApiError } from "../api";

/** An action, or a function that builds it from the latest board when its turn comes (team
 * cards and seed swaps send whole lists, which must start from what's on the board now). */
export type ActionInput = Action | ((view: BoardView) => Action | null);

export interface Runner {
  run(action: ActionInput, opts?: { quiet?: boolean }): Promise<boolean>;
  undo(): Promise<boolean>;
  /** The latest board this runner knows. */
  latest(): BoardView | null;
}

export function useActions(view: BoardView | null, setView: (v: BoardView) => void, toast: (text: string, error?: boolean) => void, onAuthLost: () => void): Runner {
  const latest = useRef(view);
  if (view && (!latest.current || latest.current.board.id !== view.board.id || view.board.version >= latest.current.board.version)) latest.current = view;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const send = useCallback(
    async (call: (id: string, version: number) => Promise<BoardView>): Promise<boolean> => {
      const v = latest.current;
      if (!v) return false;
      try {
        const next = await call(v.board.id, v.board.version);
        latest.current = next;
        setView(next);
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            toast(err.message, true);
            onAuthLost();
            return false;
          }
          if (err.code === "STALE" && err.body.view) {
            latest.current = err.body.view as BoardView;
            setView(err.body.view as BoardView);
            toast("Someone else just changed this board. You're seeing the latest now; check it and try again.", true);
            return false;
          }
        }
        toast(err instanceof Error ? err.message : "That didn't work.", true);
        return false;
      }
    },
    [setView, toast, onAuthLost],
  );

  const run = useCallback(
    (input: ActionInput): Promise<boolean> => {
      const p = queue.current.then(async () => {
        const v = latest.current;
        if (!v) return false;
        const action = typeof input === "function" ? input(v) : input;
        if (!action) return false;
        try {
          const next = await api.act(v.board.id, v.board.version, action);
          latest.current = next;
          setView(next);
          return true;
        } catch (err) {
          if (err instanceof ApiError && err.code === "REFLOW") {
            const affected = Array.isArray(err.body.affected) ? (err.body.affected as string[]) : [];
            const ok = window.confirm(`${err.message}\n\nCleared: ${affected.join(", ")}\n\nGo ahead?`);
            if (!ok) return false;
            return send((id, version) => api.act(id, version, { ...action, force: true } as Action));
          }
          return send(() => Promise.reject(err));
        }
      });
      queue.current = p.catch(() => undefined);
      return p;
    },
    [send, setView],
  );

  const undo = useCallback(() => {
    const p = queue.current.then(() => send((id, version) => api.undo(id, version)));
    queue.current = p.catch(() => undefined);
    return p;
  }, [send]);

  const getLatest = useCallback(() => latest.current, []);
  return { run, undo, latest: getLatest };
}
