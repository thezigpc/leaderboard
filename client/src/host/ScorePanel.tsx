// The "Score" tab: the fastest way to enter results for each format.

import { useEffect, useMemo, useRef, useState } from "react";
import { hasSeason, ladderTargets, type Board, type BoardView, type DerivedMatch, type PublicBoard } from "@leaderboard/shared";
import { formatTime, namesOf, parseTime, valueText } from "../ui/format";
import { MatchLine } from "../ui/Matches";
import { GroupTables, StandingsTable } from "../ui/Standings";
import { ResultSheet } from "./ResultSheet";
import { SeasonTools } from "./SeasonTools";
import type { Runner } from "./useActions";

const asBoard = (b: PublicBoard) => b as unknown as Board;

export function ScorePanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  if (b.status === "draft" && b.format !== "points" && b.format !== "best")
    return <p className="empty">Add the entrants, then start the board (Entrants tab) to keep score.</p>;
  if (b.format === "points" && (hasSeason(b) || b.kind === "season")) return <SeasonPanel view={view} run={run} />;
  if (b.format === "points" && b.settings.points.scoring === "rounds") return <RoundsPanel view={view} run={run} />;
  if (b.format === "best") return <BestPanel view={view} run={run} />;
  return <MatchesPanel view={view} run={run} />;
}

function SeasonPanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  return (
    <>
      <p className="muted">This season board adds up its nights: boards linked in Setup, and results added here. Score the nightly boards; this one follows.</p>
      <StandingsTable view={view} compact />
      <SeasonTools view={view} run={run} />
    </>
  );
}

// ----------------------------------------------------------------- points table, by round

function ScoreInput({ value, onCommit, label }: { value: number | undefined; onCommit: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? "" : String(value));
  }, [value]);
  const commit = () => {
    const t = text.trim();
    const v = t === "" ? null : Number(t.replace(",", "."));
    if (v !== null && !Number.isFinite(v)) return setText(value === undefined ? "" : String(value));
    if ((v ?? undefined) !== value) onCommit(v);
  };
  return (
    <input
      className="score-input"
      inputMode="decimal"
      maxLength={8}
      aria-label={label}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // Enter goes to the next team.
        const inputs = [...document.querySelectorAll<HTMLInputElement>(".score-input")];
        const i = inputs.indexOf(e.currentTarget);
        if (inputs[i + 1]) inputs[i + 1].focus();
        else e.currentTarget.blur();
      }}
    />
  );
}

function RoundsPanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const rounds = b.settings.points.rounds;
  // Start on the first round that isn't complete.
  const firstOpen = rounds.find((r) => b.participants.some((p) => !p.withdrawn && b.scores[p.id]?.[r.id] === undefined))?.id ?? rounds.at(-1)?.id;
  const [rid, setRid] = useState(firstOpen ?? "");
  const round = rounds.find((r) => r.id === rid) ?? rounds[0];
  const [sort, setSort] = useState<"name" | "place">("name");
  const rows = useMemo(() => {
    const totals = new Map(view.derived.standings.map((r) => [r.id, r]));
    const list = b.participants.filter((p) => !p.withdrawn).map((p) => ({ p, row: totals.get(p.id) }));
    return sort === "name" ? list.sort((x, y) => x.p.name.localeCompare(y.p.name)) : list.sort((x, y) => (x.row?.place || 999) - (y.row?.place || 999));
  }, [b.participants, view.derived.standings, sort]);
  if (!round) return <p className="empty">Add a round in Setup.</p>;
  return (
    <div className="rounds-panel">
      <div className="chips round-chips">
        {rounds.map((r) => {
          const filled = b.participants.filter((p) => !p.withdrawn).every((p) => b.scores[p.id]?.[r.id] !== undefined);
          return (
            <button key={r.id} className={`${r.id === round.id ? "on" : ""} ${filled ? "filled" : ""}`} onClick={() => setRid(r.id)}>
              {r.name}
            </button>
          );
        })}
      </div>
      {b.participants.length === 0 && <p className="empty">Add teams in the Entrants tab.</p>}
      <div className="round-rows">
        <div className="rr-head">
          <button className="link" onClick={() => setSort(sort === "name" ? "place" : "name")}>
            Sorted by {sort === "name" ? "name" : "place"} ⇅
          </button>
          <span>{round.name}</span>
          <span>Total</span>
        </div>
        {rows.map(({ p, row }) => {
          const v = b.scores[p.id]?.[round.id];
          return (
            <div className="rr-row" key={p.id}>
              <span className="rr-name">
                {row?.place ? <span className="rr-place">{row.place}</span> : null}
                {p.name}
              </span>
              <span className="rr-input">
                <button aria-label={`${p.name} minus one`} onClick={() => run({ type: "score", pid: p.id, roundId: round.id, value: (v ?? 0) - 1 })}>
                  −
                </button>
                <ScoreInput value={v} label={`${p.name} ${round.name}`} onCommit={(nv) => void run({ type: "score", pid: p.id, roundId: round.id, value: nv })} />
                <button aria-label={`${p.name} plus one`} onClick={() => run({ type: "score", pid: p.id, roundId: round.id, value: (v ?? 0) + 1 })}>
                  +
                </button>
              </span>
              <span className="rr-total">{valueText(view, row?.value)}</span>
            </div>
          );
        })}
      </div>
      <details className="all-rounds">
        <summary>All rounds</summary>
        <div className="scroll-x">
          <StandingsTable view={view} compact />
        </div>
      </details>
    </div>
  );
}

// ----------------------------------------------------------------- best score / time

function BestPanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const time = b.settings.best.unit === "time";
  const names = namesOf(b);
  const [who, setWho] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const add = async () => {
    const v = time ? parseTime(text) : Number(text.replace(",", "."));
    if (v === null || !Number.isFinite(v)) return setErr(time ? "Type a time like 1:02.5 or 62.5" : "Type a number.");
    setErr("");
    if (await run({ type: "attempt", pid: who, value: v })) setText("");
  };
  const recent = [...b.attempts].sort((x, y) => y.at - x.at).slice(0, 12);
  return (
    <div className="best-panel">
      <div className="card">
        <label>
          Who
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Pick…</option>
            {[...b.participants]
              .filter((p) => !p.withdrawn)
              .sort((x, y) => x.name.localeCompare(y.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {b.settings.best.label}
          {time ? " (m:ss.ss)" : ""}
          <input inputMode={time ? "text" : "decimal"} autoCapitalize="none" maxLength={12} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && who && add()} />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="primary wide" disabled={!who || !text.trim()} onClick={add}>
          Add attempt
        </button>
      </div>
      <StandingsTable view={view} compact onRow={(r) => setWho(r.id)} />
      {recent.length > 0 && (
        <>
          <h3>Latest attempts</h3>
          <ul className="attempts">
            {recent.map((a) => (
              <li key={a.id}>
                <span>{names.get(a.pid)}</span>
                <b>{time ? formatTime(a.value) : a.value}</b>
                <button className="icon" aria-label="Remove attempt" onClick={() => window.confirm("Remove this attempt?") && run({ type: "removeAttempt", id: a.id })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- matches: brackets, round robin, league, ladder

function NewMatch({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const ladder = b.format === "ladder";
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const people = b.participants.filter((p) => !p.withdrawn).sort((p, q) => p.name.localeCompare(q.name));
  const targets = ladder && x ? new Set(ladderTargets(asBoard(b), x)) : null;
  const names = namesOf(b);
  return (
    <div className="card new-match">
      <h3>{ladder ? "New challenge" : "New match"}</h3>
      <div className="two">
        <select value={x} onChange={(e) => (setX(e.target.value), setY(""))}>
          <option value="">{ladder ? "Challenger…" : "Player…"}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={y} onChange={(e) => setY(e.target.value)} disabled={!x}>
          <option value="">{ladder ? "Challenges…" : "vs…"}</option>
          {(targets ? [...targets].map((id) => ({ id, name: names.get(id)! })) : people.filter((p) => p.id !== x)).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {ladder && x && targets?.size === 0 && <p className="muted small">Nobody in reach is free to challenge right now.</p>}
      <button
        className="primary wide"
        disabled={!x || !y}
        onClick={async () => {
          if (await run(ladder ? { type: "challenge", challenger: x, defender: y } : { type: "leagueMatch", a: x, b: y })) {
            setX("");
            setY("");
          }
        }}
      >
        Add
      </button>
    </div>
  );
}

function MatchesPanel({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const d = view.derived;
  const names = useMemo(() => namesOf(b), [b]);
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const adHoc = b.format === "ladder" || b.format === "points";
  const visible = d.matches.filter((m) => m.state !== "bye" && m.state !== "skipped");
  const waiting = visible.filter((m) => m.state === "waiting");
  const done = visible.filter((m) => m.state === "done").sort((x, y) => (y.result?.at ?? 0) - (x.result?.at ?? 0));
  const openMatch = open ? d.matches.find((m) => m.id === open) : undefined;
  const line = (m: DerivedMatch) => <MatchLine key={m.id} m={m} names={names} all={d.matches} onClick={() => setOpen(m.id)} />;
  return (
    <div className="matches-panel">
      {d.complete && (b.format === "single" || b.format === "double" || b.format === "roundrobin") && b.status === "live" && (
        <p className="done-banner">All matches are in. Finish the board in Setup when you're ready.</p>
      )}
      {adHoc && b.status === "live" && <NewMatch view={view} run={run} />}
      <h3>Up next {d.upNext.length ? `(${d.upNext.length})` : ""}</h3>
      {d.upNext.length === 0 && <p className="muted">{adHoc ? "No matches waiting." : "Nothing ready to play."}</p>}
      {d.upNext.map(line)}
      {waiting.length > 0 && (
        <details>
          <summary>Waiting for players ({waiting.length})</summary>
          {waiting.map(line)}
        </details>
      )}
      {done.length > 0 && (
        <>
          <button className="link" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"} results ({done.length})
          </button>
          {showDone && done.map(line)}
        </>
      )}
      {b.format === "roundrobin" ? <GroupTables view={view} compact /> : <StandingsTable view={view} compact />}
      {adHoc &&
        d.upNext.length > 0 &&
        d.upNext.map((m) => (
          <button key={`rm-${m.id}`} className="link small" onClick={() => window.confirm(`Remove ${m.label.toLowerCase()} ${names.get((m.a as { id: string }).id)} vs ${names.get((m.b as { id: string }).id)}?`) && run(b.format === "ladder" ? { type: "removeChallenge", id: m.id } : { type: "removeLeagueMatch", id: m.id })}>
            Remove {names.get((m.a as { id: string }).id)} vs {names.get((m.b as { id: string }).id)}
          </button>
        ))}
      {openMatch && <ResultSheet view={view} m={openMatch} run={run} names={names} onClose={() => setOpen(null)} />}
    </div>
  );
}
