// The "Entrants" tab: paste names, rename, seed, remove (before the start) or withdraw a
// no-show (after it), then start the board.

import { useState } from "react";
import { MAX_DOUBLE, MAX_SINGLE, seedList, type Board, type BoardView } from "@leaderboard/shared";
import type { Runner } from "./useActions";

export function EntrantsPanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const [text, setText] = useState("");
  const draft = b.status === "draft";
  const seeded = b.format === "single" || b.format === "double" || b.format === "roundrobin" || b.format === "ladder";
  const closed = !draft && (b.format === "single" || b.format === "double" || b.format === "roundrobin");
  const order = seeded ? seedList(b as unknown as Board) : b.participants.map((p) => p.id);
  const byId = new Map(b.participants.map((p) => [p.id, p]));
  const max = b.format === "double" ? MAX_DOUBLE : b.format === "single" ? MAX_SINGLE : 128;

  const move = (i: number, d: number) => {
    const ids = [...order];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run({ type: "seeds", ids });
  };
  const add = async () => {
    if (await run({ type: "addParticipants", names: [text] })) setText("");
  };

  return (
    <div className="entrants">
      {!closed && (
        <div className="card">
          <label>
            Add {b.participants.length ? "more" : "entrants"}: one per line
            <textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Alex\nSam\nThe Quizzards: Jo, Kim, Lee"}
            />
          </label>
          <p className="muted small">For a team with members, write "Team: member, member". Pasting from a spreadsheet works too (team in the first column).</p>
          <button className="primary wide" disabled={!text.trim()} onClick={add}>
            Add
          </button>
        </div>
      )}
      {closed && <p className="muted">Entries are closed now that the {b.format === "roundrobin" ? "schedule" : "bracket"} has started. Remove a no-show to give their opponents walkovers.</p>}

      <div className="entrant-head">
        <h3>
          {b.participants.length} {b.participants.length === 1 ? "entrant" : "entrants"}
          {seeded && draft && b.participants.length > 1 ? " · in seed order" : ""}
        </h3>
        {seeded && draft && b.participants.length > 2 && (
          <button className="link" onClick={() => run({ type: "shuffle" })}>
            Shuffle
          </button>
        )}
      </div>
      {b.participants.length > max && <p className="error">This format takes up to {max}.</p>}
      <ol className="entrant-list">
        {order.map((id, i) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <li key={id} className={p.withdrawn ? "out" : ""}>
              {seeded && <span className="seed">{i + 1}</span>}
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
                  <button className="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="icon" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
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
                  aria-label={draft ? "Remove" : "Withdraw"}
                  onClick={() => window.confirm(draft ? `Remove ${p.name}?` : `Withdraw ${p.name}? Their remaining matches become walkovers.`) && run({ type: "removeParticipant", id })}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {draft && (
        <button className="primary wide big" onClick={() => run({ type: "start" })}>
          Start the board
        </button>
      )}
    </div>
  );
}
