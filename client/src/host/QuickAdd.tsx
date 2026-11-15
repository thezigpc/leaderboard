// Players, one at a time: type a name, press Enter, it's in, and the keyboard stays up.
// Names from earlier boards are suggested; a name already on the list asks first; the last
// one added can be taken back.

import { useEffect, useMemo, useRef, useState } from "react";
import { entrantLine, seedList, similarNames, type Board, type BoardView } from "@leaderboard/shared";
import { usePeople } from "./kit";
import type { Runner } from "./useActions";

export function QuickAdd({ view, run, placeholder = "Add a name" }: { view: BoardView; run: Runner["run"]; placeholder?: string }) {
  const b = view.board;
  const people = usePeople(b.id);
  const [text, setText] = useState("");
  const [dup, setDup] = useState("");
  // "Did you mean Alex B.?" before a new spelling of a regular splits their history.
  const [near, setNear] = useState<{ typed: string; names: string[] } | null>(null);
  const [last, setLast] = useState<{ id: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 8000);
    return () => clearTimeout(t);
  }, [last]);

  const taken = useMemo(() => new Set(b.participants.map((p) => p.name.toLowerCase())), [b.participants]);
  const typed = text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!typed || !people) return [];
    return people.players
      .filter((p) => !taken.has(p.name.toLowerCase()) && p.name.toLowerCase() !== typed && p.name.toLowerCase().split(/\s+/).some((w, i, all) => w.startsWith(typed) || all.slice(i).join(" ").startsWith(typed)))
      .slice(0, 3);
  }, [typed, people, taken]);

  const add = async (raw: string, force = false) => {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (!force && taken.has(name.toLowerCase())) {
      setDup(b.participants.find((p) => p.name.toLowerCase() === name.toLowerCase())?.name ?? name);
      return;
    }
    if (!force && people && !people.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      const like = similarNames(
        name,
        people.players.map((p) => p.name).filter((n) => !taken.has(n.toLowerCase())),
        2,
      );
      if (like.length) return setNear({ typed: name, names: like });
    }
    setDup("");
    setNear(null);
    expecting.current = true;
    // A name is one entrant here, even with a comma or colon in it.
    const ok = await run({ type: "addParticipants", names: [entrantLine({ name: name.replace(/[,;\t]/g, " ") })] });
    if (ok) {
      setText("");
      input.current?.focus();
    } else expecting.current = false;
  };

  // The entrant this field just added (for "Added Sam · Undo"): the one that wasn't there before.
  const expecting = useRef(false);
  const prevIds = useRef<Set<string>>(new Set(b.participants.map((p) => p.id)));
  useEffect(() => {
    const added = b.participants.filter((p) => !prevIds.current.has(p.id));
    prevIds.current = new Set(b.participants.map((p) => p.id));
    if (expecting.current && added.length === 1) {
      expecting.current = false;
      setLast({ id: added[0].id, name: added[0].name });
    }
  }, [b.participants]);

  const free = (name: string) => {
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
  };

  return (
    <div className="quick-add">
      <form
        className="qa-row"
        onSubmit={(e) => {
          e.preventDefault();
          void add(text);
        }}
      >
        <label className="qa-field">
          <span className="sr">{placeholder}</span>
          <input
            ref={input}
            value={text}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setDup("");
              setNear(null);
            }}
          />
          <span className="hint">Enter adds</span>
        </label>
        <button className="primary qa-add" aria-label="Add" disabled={!text.trim()}>
          +
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="qa-suggest">
          <span className="lab">From earlier boards</span>
          <div className="chips">
            {suggestions.map((p) => (
              <button key={p.name} type="button" onClick={() => void add(p.name)}>
                {p.name} <small className="muted">{p.times}×</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {near && (
        <div className="notice warn">
          <span>Did you mean {near.names.join(" or ")}? They've played here before.</span>
          <span className="chips">
            {near.names.map((n) => (
              <button key={n} className="primary" onClick={() => void add(n, true)}>
                {n}
              </button>
            ))}
            <button onClick={() => void add(near.typed, true)}>Keep “{near.typed}”</button>
          </span>
        </div>
      )}
      {dup && (
        <div className="notice warn">
          <span>{dup} is already on the list.</span>
          <button className="link" onClick={() => void add(free(dup), true)}>
            Add "{free(dup)}"
          </button>
        </div>
      )}
      {last && (
        <div className="undo-bar" role="status">
          <span>Added {last.name}</span>
          <button
            className="link"
            onClick={() => {
              const id = last.id;
              setLast(null);
              void run({ type: "removeParticipant", id });
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/** The players on a board: newest first while adding, or in seed order where that matters. */
export function PlayerList({ view, run, seeded }: { view: BoardView; run: Runner["run"]; seeded: boolean }) {
  const b = view.board;
  const draft = b.status === "draft";
  const byId = new Map(b.participants.map((p) => [p.id, p]));
  const order = seeded ? seedList(b as unknown as Board) : [...b.participants].reverse().map((p) => p.id);
  const move = (i: number, d: number) =>
    run((v) => {
      const ids = seedList(v.board as unknown as Board);
      const j = i + d;
      if (j < 0 || j >= ids.length) return null;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { type: "seeds", ids };
    });
  return (
    <ol className="entrant-list">
      {order.map((id, i) => {
        const p = byId.get(id);
        if (!p) return null;
        const n = seeded ? i + 1 : b.participants.length - i;
        return (
          <li key={id} className={p.withdrawn ? "out" : ""}>
            <span className="seed">{n}</span>
            <button
              className="name link"
              onClick={() => {
                const name = window.prompt("Name", p.name);
                if (name !== null && name.trim() && name !== p.name) void run({ type: "editParticipant", id, name });
              }}
            >
              {p.name}
              {p.members?.length ? <small>{p.members.join(", ")}</small> : null}
            </button>
            {seeded && draft && (
              <>
                <button className="icon" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon" aria-label={`Move ${p.name} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </>
            )}
            {p.withdrawn ? (
              <button className="link small" onClick={() => run({ type: "restoreParticipant", id })}>
                Restore
              </button>
            ) : (
              <button
                className="icon"
                aria-label={draft ? `Remove ${p.name}` : `Withdraw ${p.name}`}
                onClick={() => (draft || window.confirm(`Withdraw ${p.name}? Their remaining matches become walkovers.`)) && run({ type: "removeParticipant", id })}
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
