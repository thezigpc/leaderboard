// The bracket tab before the start: the bracket is the seeding screen. Tap a name, then
// another, and they swap. On a wide screen the whole bracket is drawn and names can also be
// dragged from the seed list or between slots. Byes stay with the top seeds.
// Warns when last time's finalists (the board this was copied from) would meet early.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apartSwap, meetingRound, seedList, type Board, type BoardView, type DerivedMatch } from "@leaderboard/shared";
import { api } from "../api";
import { useDrag, type DragItem } from "./kit";
import type { Runner } from "./useActions";

/** Last time's two finalists (names), from the board this one was copied from. */
function useLastFinal(view: BoardView): [string, string] | null {
  const from = view.board.copiedFrom;
  const [pair, setPair] = useState<[string, string] | null>(null);
  useEffect(() => {
    if (!from) return setPair(null);
    let live = true;
    api.board(from).then(
      (v) => {
        if (!live || v.board.status !== "finished") return;
        const names = new Map(v.board.participants.map((p) => [p.id, p.name]));
        const d = v.derived;
        let ids: string[] = [];
        if (v.board.format === "single" || v.board.format === "double") {
          const w = d.matches.filter((m) => m.section === "W");
          const last = v.board.format === "double" ? d.matches.find((m) => m.section === "GF") : w.sort((a, b) => b.round - a.round)[0];
          if (last && last.a.kind === "player" && last.b.kind === "player") ids = [last.a.id, last.b.id];
        } else {
          const top = d.standings.filter((r) => r.place === 1 || r.place === 2);
          if (top.length === 2) ids = top.map((r) => r.id);
        }
        if (ids.length === 2) setPair([names.get(ids[0])!, names.get(ids[1])!]);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [from]);
  return pair;
}

export function BracketSetup({ view, run, wide, onStarted }: { view: BoardView; run: Runner["run"]; wide: boolean; onStarted: () => void }) {
  const b = view.board;
  const k = b.format === "double" ? "double" : "single";
  const s = b.settings[k];
  const names = useMemo(() => new Map(b.participants.map((p) => [p.id, p.name])), [b.participants]);
  const seeds = seedList(b as unknown as Board);
  const seedOf = (id: string) => seeds.indexOf(id) + 1;
  const n = seeds.length;
  const w = view.derived.matches.filter((m) => m.section === "W");
  const rounds = Math.max(0, ...w.map((m) => m.round));
  const round1 = w.filter((m) => m.round === 1).sort((a, b) => a.index - b.index);
  const byes = round1.filter((m) => m.a.kind === "bye" || m.b.kind === "bye").length;
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const swap = (x: string, y: string) => {
    setPicked(null);
    if (x === y) return;
    void run((v) => {
      const ids = seedList(v.board as unknown as Board);
      const i = ids.indexOf(x);
      const j = ids.indexOf(y);
      if (i < 0 || j < 0) return null;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { type: "seeds", ids };
    });
  };
  const tap = (id: string) => {
    if (!picked) return setPicked(id);
    if (picked === id) return setPicked(null);
    swap(picked, id);
  };
  const drag = useDrag(wide, (item: DragItem, target: string) => {
    if (target.startsWith("p:")) swap(item.id, target.slice(2));
  });

  // Last time's final, again too early?
  const final = useLastFinal(view);
  const apart = useMemo(() => {
    if (!final || n < 4) return null;
    const idOf = (name: string) => b.participants.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id;
    const ia = idOf(final[0]);
    const ib = idOf(final[1]);
    if (!ia || !ib) return null;
    const r = meetingRound(n, seedOf(ia), seedOf(ib));
    if (r >= rounds) return null;
    const label = w.find((m) => m.round === r)?.label ?? `round ${r}`;
    const other = apartSwap(n, seedOf(ia), seedOf(ib));
    return { a: final[0], b: final[1], label, fix: other ? () => swap(ib, seeds[other - 1]) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final, n, seeds.join(","), rounds]);

  const start = async () => {
    setBusy(true);
    const ok = await run({ type: "start" });
    setBusy(false);
    if (ok) onStarted();
  };

  if (n < 2) return <p className="empty">Add at least two entrants first, then seed the bracket here.</p>;

  const slot = (m: DerivedMatch, side: "a" | "b", edit: boolean) => {
    const sl = m[side];
    if (sl.kind === "bye") return <div className="bslot bye">bye</div>;
    if (sl.kind === "pending") {
      const src = w.find((x) => x.id === sl.from);
      return <div className="bslot tbd">Winner of {src ? matchName(src, w) : "…"}</div>;
    }
    const id = sl.id;
    if (!edit)
      return (
        <div className="bslot through">
          <span className="sd">{seedOf(id)}</span>
          {names.get(id)}
        </div>
      );
    const on = picked === id;
    const target = picked && picked !== id;
    return (
      <button
        className={`bslot player ${on ? "sel" : ""} ${target ? "target" : ""} ${drag.over === `p:${id}` ? "over" : ""} ${drag.dragging === id ? "dragging" : ""}`}
        data-drop={`p:${id}`}
        aria-pressed={on}
        onClick={() => tap(id)}
        {...drag.bind({ id, label: names.get(id) ?? "" })}
      >
        <span className="sd">{seedOf(id)}</span>
        <span className="nm">{names.get(id)}</span>
        {on ? <span className="tag">picked</span> : target ? <span className="tag">swap</span> : null}
      </button>
    );
  };

  const header = (
    <div className="bracket-tools">
      <p className="muted small">
        {n} {b.entry?.kind === "teams" ? "teams" : "entrants"}
        {byes ? ` · ${byes} ${byes === 1 ? "bye goes" : "byes go"} to the top ${byes === 1 ? "seed" : "seeds"}` : ""}
      </p>
      <div className="tool-row">
        <button onClick={() => (setPicked(null), void run({ type: "shuffle" }))}>🔀 Shuffle</button>
        <Link className="button" to={`/tv?board=${b.id}`} target="_blank" rel="noopener">
          📺 Preview on TV
        </Link>
      </div>
    </div>
  );

  const notice = (
    <>
      {picked && (
        <div className="notice info" role="status">
          <span>{names.get(picked)} is picked. Tap another name to swap places.</span>
          <button className="link" onClick={() => setPicked(null)}>
            Cancel
          </button>
        </div>
      )}
      {apart && (
        <div className="notice warn">
          <span>
            {apart.a} and {apart.b} played last time's final. They'd meet again in the {apart.label.toLowerCase()}.
          </span>
          {apart.fix && (
            <button className="link" onClick={apart.fix}>
              Keep them apart
            </button>
          )}
        </div>
      )}
    </>
  );

  const rules = (
    <div className="bracket-rules">
      <label className="inline">
        Matches are best of
        <select value={s.bestOf} onChange={(e) => run({ type: "settings", settings: { [k]: { bestOf: Number(e.target.value) } } })}>
          {[1, 3, 5, 7, 9].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {k === "single" ? (
        <label className="check">
          <input type="checkbox" checked={s.thirdPlace} onChange={(e) => run({ type: "settings", settings: { single: { thirdPlace: e.target.checked } } })} /> Third-place match
        </label>
      ) : (
        <label className="check">
          <input type="checkbox" checked={s.bracketReset} onChange={(e) => run({ type: "settings", settings: { double: { bracketReset: e.target.checked } } })} /> Bracket reset: the
          winners-bracket champion has to lose twice
        </label>
      )}
    </div>
  );

  const startButton = (
    <button className="primary wide big" disabled={busy} onClick={start}>
      Start the bracket
    </button>
  );

  if (!wide) {
    return (
      <div className="bracket-setup">
        {header}
        {notice}
        <p className="lab">{round1[0]?.label ?? "Round 1"}</p>
        <div className="r1-list">
          {round1.map((m) => {
            const bye = m.a.kind === "bye" || m.b.kind === "bye";
            return (
              <div key={m.id} className={`r1-card ${bye ? "has-bye" : ""}`}>
                <div className="r1-head">
                  <span>Match {m.index + 1}</span>
                  <span>{bye ? "Bye: straight through" : m.lane ?? ""}</span>
                </div>
                {slot(m, "a", true)}
                {slot(m, "b", true)}
              </div>
            );
          })}
        </div>
        {b.format === "double" && <p className="muted small">The losers bracket fills from these results.</p>}
        {rules}
        {startButton}
      </div>
    );
  }

  // Wide: the winners bracket drawn out, the seed list beside it.
  const CW = 210;
  const CH = 74;
  const GX = 44;
  const UNIT = 94;
  const c1 = round1.length;
  const H = c1 * UNIT;
  const pos = (m: DerivedMatch) => {
    const count = c1 / 2 ** (m.round - 1);
    return { x: (m.round - 1) * (CW + GX), y: (H * (m.index + 0.5)) / count - CH / 2 };
  };
  const links = w
    .filter((m) => m.round < rounds)
    .map((m) => {
      const p = pos(m);
      const t = pos(w.find((x) => x.round === m.round + 1 && x.index === Math.floor(m.index / 2))!);
      const xm = t.x - GX / 2;
      return `M${p.x + CW} ${p.y + CH / 2}H${xm}V${t.y + CH / 2}H${t.x}`;
    });
  const width = rounds * (CW + GX) - GX;

  return (
    <div className="bracket-setup wide">
      <aside className="seed-side">
        <p className="lab">Seeds{wide ? " · drag onto the bracket" : ""}</p>
        <ol className="seed-list">
          {seeds.map((id, i) => {
            const hasBye = i < byes;
            return (
              <li key={id}>
                <button
                  className={`seed-row ${picked === id ? "sel" : ""} ${drag.over === `p:${id}` ? "over" : ""}`}
                  data-drop={`p:${id}`}
                  onClick={() => tap(id)}
                  {...drag.bind({ id, label: names.get(id) ?? "" })}
                >
                  <span className="sd">{i + 1}</span>
                  <span className="nm">{names.get(id)}</span>
                  {hasBye && <small>bye</small>}
                </button>
              </li>
            );
          })}
        </ol>
        {rules}
      </aside>
      <div className="bracket-main">
        {header}
        {notice}
        <div className="bracket-edit-scroll">
          <div className="bracket-edit" style={{ width, height: H + 30 }}>
            <svg className="links" width={width} height={H + 30} aria-hidden="true">
              {links.map((d, i) => (
                <path key={i} d={d} transform="translate(0 30)" />
              ))}
            </svg>
            {Array.from({ length: rounds }, (_, r) => (
              <div key={r} className="round-label" style={{ left: r * (CW + GX), top: 0, width: CW }}>
                {w.find((m) => m.round === r + 1)?.label}
              </div>
            ))}
            {w.map((m) => {
              const p = pos(m);
              const bye = m.a.kind === "bye" || m.b.kind === "bye";
              return (
                <div key={m.id} className={`bcard ${bye && m.round === 1 ? "has-bye" : ""}`} style={{ left: p.x, top: p.y + 30, width: CW, height: CH }}>
                  <span className="mno">{matchName(m, w)}</span>
                  {slot(m, "a", m.round === 1)}
                  {slot(m, "b", m.round === 1)}
                </div>
              );
            })}
          </div>
        </div>
        {b.format === "double" && <p className="muted small">The losers bracket and grand final fill from these results.</p>}
        {startButton}
      </div>
      {drag.ghost}
    </div>
  );
}

/** "M3": matches numbered through the winners bracket, round by round. */
function matchName(m: DerivedMatch, w: DerivedMatch[]): string {
  const sorted = [...w].sort((a, b) => a.round - b.round || a.index - b.index);
  return `M${sorted.findIndex((x) => x.id === m.id) + 1}`;
}
