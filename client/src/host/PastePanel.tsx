// Paste or type a list, see how it was read (teams, members, a skipped header, duplicates)
// and fix it before anything is added.

import { useMemo, useState } from "react";
import { entrantLine, readEntrants, type BoardView } from "@leaderboard/shared";
import type { Runner } from "./useActions";

interface Item {
  name: string;
  members?: string[];
  line: number;
  /** Another line of this paste has the same name (the first one keeps it). */
  dupOf?: number;
  /** Already on the board. */
  onBoard?: boolean;
}

export function PastePanel({ view, run, onDone }: { view: BoardView; run: Runner["run"]; onDone?: () => void }) {
  const b = view.board;
  const teams = b.entry?.kind === "teams";
  const [text, setText] = useState("");
  const [merged, setMerged] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const read = useMemo(() => readEntrants(text), [text]);
  const items: Item[] = useMemo(() => {
    const onBoard = new Set(b.participants.map((p) => p.name.toLowerCase()));
    const first = new Map<string, number>();
    return read.entrants.map((e) => {
      const key = e.name.toLowerCase();
      const it: Item = { ...e };
      if (first.has(key)) it.dupOf = first.get(key);
      else first.set(key, e.line);
      if (onBoard.has(key)) it.onBoard = true;
      return it;
    });
  }, [read, b.participants]);

  // What will be added: merged duplicates fold their members into the first, skipped ones drop.
  const final = useMemo(() => {
    const out = new Map<number, { name: string; members?: string[] }>();
    for (const it of items) {
      if (skipped.has(it.line)) continue;
      if (it.dupOf !== undefined && merged.has(it.line) && out.has(it.dupOf)) {
        const t = out.get(it.dupOf)!;
        const ms = [...(t.members ?? [])];
        for (const m of it.members ?? []) if (!ms.some((x) => x.toLowerCase() === m.toLowerCase())) ms.push(m);
        t.members = ms;
        continue;
      }
      out.set(it.line, { name: it.name, ...(it.members ? { members: [...it.members] } : {}) });
    }
    return [...out.values()];
  }, [items, merged, skipped]);

  const people = final.reduce((n, e) => n + (e.members?.length ?? 0), 0);
  const label = !final.length
    ? "Add"
    : teams || people
      ? `Add ${final.length} ${final.length === 1 ? "team" : "teams"}${people ? `, ${people} ${people === 1 ? "player" : "players"}` : ""}`
      : `Add ${final.length} ${final.length === 1 ? "name" : "names"}`;

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, line: number) => {
    const n = new Set(set);
    if (n.has(line)) n.delete(line);
    else n.add(line);
    setter(n);
  };

  return (
    <div className="paste-panel">
      <label>
        <span className="lab">Paste or type</span>
        <textarea
          rows={7}
          maxLength={20000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMerged(new Set());
            setSkipped(new Set());
          }}
          placeholder={teams ? "The Quizzards: Jo, Kim, Lee\nBrainiacs:\n  Priya\n  Sam\nTeam,Players (from a spreadsheet)" : "Alex\nSam\nPriya"}
          spellCheck={false}
        />
      </label>
      <p className="muted small">One per line. A team's players go after a colon ("Team: Jo, Kim"), on the lines under "Team:", or after a "-". Spreadsheet rows work too.</p>
      {(items.length > 0 || read.header) && (
        <>
          <p className="lab">We read it as</p>
          <ul className="read-as">
            {read.header && (
              <li className="skip">
                <span className="mark">·</span>
                <span>
                  Header row <small>skipped</small>
                </span>
              </li>
            )}
            {items.map((it) => {
              const isSkipped = skipped.has(it.line);
              const isMerged = merged.has(it.line);
              const warn = (it.dupOf !== undefined && !isMerged) || it.onBoard;
              return (
                <li key={it.line} className={`${warn && !isSkipped ? "warn" : ""} ${isSkipped || isMerged ? "skip" : ""}`}>
                  <span className="mark">{warn && !isSkipped ? "!" : "✓"}</span>
                  <span className="what">
                    <b>{it.name}</b>
                    {it.members?.length ? <small>{it.members.join(", ")}</small> : null}
                    {it.dupOf !== undefined && <small>{isMerged ? `merged into line ${it.dupOf}` : `also on line ${it.dupOf}`}</small>}
                    {it.onBoard && !isSkipped && <small>already on the board: adding makes a second one</small>}
                  </span>
                  {it.dupOf !== undefined && (
                    <button className="link small" onClick={() => toggle(merged, setMerged, it.line)}>
                      {isMerged ? "Unmerge" : "Merge"}
                    </button>
                  )}
                  {(it.onBoard || it.dupOf !== undefined) && (
                    <button className="link small" onClick={() => toggle(skipped, setSkipped, it.line)}>
                      {isSkipped ? "Keep" : "Skip"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button
        className="primary wide"
        disabled={!final.length || busy}
        onClick={async () => {
          setBusy(true);
          const ok = await run({ type: "addParticipants", names: [final.map(entrantLine).join("\n")] });
          setBusy(false);
          if (ok) {
            setText("");
            onDone?.();
          }
        }}
      >
        {label}
      </button>
    </div>
  );
}
