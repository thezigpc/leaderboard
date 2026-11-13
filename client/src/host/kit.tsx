// Small pieces the entrant and bracket screens share: a bottom sheet, "is this a wide
// screen", the regulars from earlier boards, and drag-and-drop that works with a finger or
// a mouse (on wide screens; phones tap instead).

import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { BoardView, PeopleSeen } from "@leaderboard/shared";
import { api } from "../api";

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet tall" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A wide screen (iPad, desktop): side-by-side panels and drag-and-drop. */
export function useWide(min = 900): boolean {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    on();
    return () => m.removeEventListener("change", on);
  }, [q]);
  return wide;
}

let peopleCache: { key: string; at: number; data: PeopleSeen } | null = null;

/** Regulars from earlier boards (cached for a minute). */
export function usePeople(boardId: string): PeopleSeen | null {
  const [data, setData] = useState<PeopleSeen | null>(peopleCache?.key === boardId ? peopleCache.data : null);
  useEffect(() => {
    if (peopleCache?.key === boardId && Date.now() - peopleCache.at < 60_000) return void setData(peopleCache.data);
    let live = true;
    api.people(boardId).then(
      (d) => {
        peopleCache = { key: boardId, at: Date.now(), data: d };
        if (live) setData(d);
      },
      () => live && setData({ players: [], teams: [] }),
    );
    return () => {
      live = false;
    };
  }, [boardId]);
  return data;
}

/** Every name on the board (entrants, team members, players waiting), lowercased. */
export function namesOnBoard(view: BoardView): Set<string> {
  const b = view.board;
  const s = new Set<string>();
  for (const p of b.participants) {
    s.add(p.name.toLowerCase());
    for (const m of p.members ?? []) s.add(m.toLowerCase());
  }
  for (const w of b.waiting ?? []) s.add(w.toLowerCase());
  return s;
}

export const ago = (at: number): string => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

// ----------------------------------------------------------------- drag and drop

export interface DragItem {
  id: string;
  label: string;
}

interface DragState {
  item: DragItem;
  x: number;
  y: number;
  over: string | null;
}

/**
 * Drag from elements given `bind(item)`, drop on elements with `data-drop="<target>"`.
 * A press that doesn't move is an ordinary tap (the element's onClick still runs).
 */
export function useDrag(enabled: boolean, onDrop: (item: DragItem, target: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const justDragged = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const bind = useCallback(
    (item: DragItem) => {
      if (!enabled) return {};
      return {
        style: { touchAction: "none" as const },
        onPointerDown: (e: RPointerEvent) => {
          if (e.button !== 0) return;
          const x0 = e.clientX;
          const y0 = e.clientY;
          let moving = false;
          const target = (x: number, y: number) => {
            const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
            return el?.dataset.drop ?? null;
          };
          const move = (ev: PointerEvent) => {
            if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
            moving = true;
            ev.preventDefault();
            setDrag({ item, x: ev.clientX, y: ev.clientY, over: target(ev.clientX, ev.clientY) });
          };
          const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            if (moving) {
              justDragged.current = true;
              setTimeout(() => (justDragged.current = false), 0);
              const t = target(ev.clientX, ev.clientY);
              setDrag(null);
              if (t) dropRef.current(item, t);
            }
          };
          const cancel = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            setDrag(null);
          };
          window.addEventListener("pointermove", move, { passive: false });
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", cancel);
        },
        onClickCapture: (e: RMouseEvent) => {
          if (justDragged.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        },
      };
    },
    [enabled],
  );

  const ghost = drag ? (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      {drag.item.label}
    </div>
  ) : null;

  return { bind, ghost, over: drag?.over ?? null, dragging: drag?.item.id ?? null };
}
