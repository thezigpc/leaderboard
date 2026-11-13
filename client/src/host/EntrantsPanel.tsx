// The Entrants tab. Players: a quick-add field (one name, Enter, next). Teams: team cards
// with the players waiting for one. Both: "Who's here tonight?" (regulars from earlier
// boards) and pasting a list, which sits beside the list on a wide screen. Once a bracket or
// schedule starts, entries close and a no-show can be withdrawn.

import { useState } from "react";
import type { BoardView } from "@leaderboard/shared";
import { Sheet } from "./kit";
import { PastePanel } from "./PastePanel";
import { PlayerList, QuickAdd } from "./QuickAdd";
import { RegularsSheet } from "./RegularsSheet";
import { TeamsBoard } from "./TeamsBoard";
import type { Runner } from "./useActions";

export function EntrantsPanel({ view, run, wide, onNext }: { view: BoardView; run: Runner["run"]; wide: boolean; onNext: () => void }) {
  const b = view.board;
  const draft = b.status === "draft";
  const bracket = b.format === "single" || b.format === "double";
  const closed = !draft && (bracket || b.format === "roundrobin");
  const teams = b.entry?.kind === "teams";
  const seeded = b.format === "ladder" || b.format === "roundrobin";
  const [regulars, setRegulars] = useState(false);
  const [pasting, setPasting] = useState(false);
  const count = b.participants.filter((p) => !p.withdrawn).length;

  if (closed)
    return (
      <div className="entrants">
        <p className="muted">Entries are closed now that the {b.format === "roundrobin" ? "schedule" : "bracket"} has started. Withdraw a no-show to give their opponents walkovers.</p>
        <PlayerList view={view} run={run} seeded />
      </div>
    );

  const extras = (
    <div className="entrant-extras">
      <button onClick={() => setRegulars(true)}>👥 Who's here tonight?</button>
      {!wide && <button onClick={() => setPasting(true)}>📋 Paste a list</button>}
    </div>
  );

  const main = teams ? (
    <>
      {extras}
      <TeamsBoard view={view} run={run} wide={wide} />
    </>
  ) : (
    <>
      <QuickAdd view={view} run={run} />
      {extras}
      <div className="entrant-head">
        <p className="lab">
          {count} {count === 1 ? "entrant" : "entrants"}
          {seeded && draft && b.participants.length > 1 ? " · in seed order" : b.participants.length > 1 ? " · newest first" : ""}
        </p>
        {seeded && draft && b.participants.length > 2 && (
          <button className="link" onClick={() => run({ type: "shuffle" })}>
            Shuffle
          </button>
        )}
      </div>
      <PlayerList view={view} run={run} seeded={seeded} />
    </>
  );

  return (
    <div className={`entrants ${wide ? "split" : ""}`}>
      {wide && (
        <aside className="paste-side">
          <PastePanel view={view} run={run} />
        </aside>
      )}
      <div className="entrants-main">
        {main}
        {draft && (
          <div className="next-bar">
            {bracket ? (
              <button className="primary wide big" disabled={count < 2} onClick={onNext}>
                Next: the bracket
              </button>
            ) : (
              <button className="primary wide big" disabled={b.format === "ladder" && count < 2} onClick={() => run({ type: "start" })}>
                Start the board
              </button>
            )}
          </div>
        )}
      </div>
      {regulars && <RegularsSheet view={view} run={run} onClose={() => setRegulars(false)} />}
      {pasting && (
        <Sheet title="Paste a list" onClose={() => setPasting(false)}>
          <PastePanel view={view} run={run} onDone={() => setPasting(false)} />
        </Sheet>
      )}
    </div>
  );
}
