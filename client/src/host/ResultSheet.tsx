// One match: tap the winner (scores optional), or a draw where the format allows it.
// Also: call it to a lane, record a walkover, clear the result.

import { useState } from "react";
import type { BoardView, DerivedMatch } from "@leaderboard/shared";
import { api } from "../api";
import { useMatchGames } from "./kit";
import type { Runner } from "./useActions";

export function ResultSheet({ view, m, run, names, onClose }: { view: BoardView; m: DerivedMatch; run: Runner["run"]; names: Map<string, string>; onClose: () => void }) {
  const b = view.board;
  const a = m.a.kind === "player" ? m.a.id : "";
  const c = m.b.kind === "player" ? m.b.id : "";
  const r = m.result;
  const aFirst = !r || r.a === a;
  const [sa, setSa] = useState<string>(r ? String((aFirst ? r.scoreA : r.scoreB) ?? "") : "");
  const [sb, setSb] = useState<string>(r ? String((aFirst ? r.scoreB : r.scoreA) ?? "") : "");
  const [forfeit, setForfeit] = useState(!!r?.forfeit);
  const [busy, setBusy] = useState(false);
  const games = useMatchGames();
  const [playErr, setPlayErr] = useState("");
  const bestOf = b.format === "single" ? b.settings.single.bestOf : b.format === "double" ? b.settings.double.bestOf : b.format === "roundrobin" ? b.settings.roundrobin.bestOf : b.format === "ladder" ? b.settings.ladder.bestOf : 1;
  const draws = b.format === "roundrobin" ? b.settings.roundrobin.allowDraws : b.format === "points";
  const ready = m.state === "ready" || m.state === "done";

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = async (winner: string | null | undefined) => {
    setBusy(true);
    const ok = await run({ type: "result", matchId: m.id, winner: winner as string | null, scoreA: num(sa), scoreB: num(sb), forfeit });
    setBusy(false);
    if (ok) onClose();
  };
  const step = (set: (v: string) => void, cur: string, d: number) => set(String(Math.max(0, (Number(cur) || 0) + d)));

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={m.label}>
        <header>
          <h2>{m.label}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {m.state === "ready" && <PlayOnBox view={view} m={m} games={games} error={playErr} setError={setPlayErr} />}
        {!ready ? (
          <p className="muted">Waiting for both players.</p>
        ) : (
          <>
            <div className="winner-buttons">
              <button className={`win ${r?.winner === a ? "chosen" : ""}`} disabled={busy} onClick={() => save(a)}>
                {names.get(a)}
                <small>won</small>
              </button>
              <button className={`win ${r?.winner === c ? "chosen" : ""}`} disabled={busy} onClick={() => save(c)}>
                {names.get(c)}
                <small>won</small>
              </button>
            </div>
            {draws && (
              <button className={`wide ${r && r.winner === null ? "chosen" : ""}`} disabled={busy} onClick={() => save(null)}>
                Draw
              </button>
            )}
            <div className="scores">
              <p className="muted small">{bestOf > 1 ? `Games won (best of ${bestOf}), optional` : "Score, optional"}. Enter it before tapping the winner, or save the score alone and the higher one wins.</p>
              {[
                [a, sa, setSa],
                [c, sb, setSb],
              ].map(([id, v, set]) => (
                <div className="score-row" key={id as string}>
                  <span>{names.get(id as string)}</span>
                  <button type="button" onClick={() => step(set as (v: string) => void, v as string, -1)}>
                    −
                  </button>
                  <input inputMode="decimal" value={v as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} />
                  <button type="button" onClick={() => step(set as (v: string) => void, v as string, 1)}>
                    +
                  </button>
                </div>
              ))}
              {sa.trim() !== "" && sb.trim() !== "" && (
                <button className="primary wide" disabled={busy} onClick={() => save(undefined)}>
                  Save score
                </button>
              )}
              <label className="check">
                <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} /> Walkover / forfeit (the winner didn't have to play)
              </label>
            </div>
          </>
        )}
        {b.lanes.length > 0 && m.state !== "done" && (
          <div className="lane-pick">
            <span>Lane</span>
            <div className="chips">
              {b.lanes.map((l) => (
                <button key={l} className={m.lane === l ? "on" : ""} onClick={() => run({ type: "lane", matchId: m.id, lane: m.lane === l ? null : l })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        {m.state === "ready" && (
          <button className="wide" onClick={() => run({ type: "call", matchId: m.id, called: !m.calledAt })}>
            {m.calledAt ? "Uncall (back in the queue)" : "Call it now (top of up next)"}
          </button>
        )}
        {m.state === "done" && (
          <button
            className="danger wide"
            disabled={busy}
            onClick={async () => {
              if (await run({ type: "clearResult", matchId: m.id })) onClose();
            }}
          >
            Clear result
          </button>
        )}
      </div>
    </div>
  );
}

/** "Play in Pool": the box makes a room in that game for this match, and its result comes back
 * here by itself. Shown when the box has a game that plays two-sided matches. */
function PlayOnBox({ view, m, games, error, setError }: { view: BoardView; m: DerivedMatch; games: { id: string; name: string }[]; error: string; setError: (s: string) => void }) {
  const [starting, setStarting] = useState("");
  if (m.game)
    return (
      <div className="play-box on">
        <p>
          🎮 Playing in <b>{m.game.name}</b>, room <b className="room">{m.game.room}</b>
        </p>
        {m.game.joinUrl && (
          <a href={m.game.joinUrl} target="_blank" rel="noreferrer">
            Open the room
          </a>
        )}
        <p className="muted small">The result comes back here when the game ends. Tap the winner below to enter it yourself instead.</p>
      </div>
    );
  if (!games.length && !m.note) return null;
  return (
    <div className="play-box">
      {m.note && <p className="note">{m.note}</p>}
      {games.length > 0 && (
        <div className="chips">
          {games.map((g) => (
            <button
              key={g.id}
              disabled={!!starting}
              onClick={async () => {
                setStarting(g.id);
                setError("");
                try {
                  await api.playMatch(view.board.id, m.id, g.id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setStarting("");
                }
              }}
            >
              {starting === g.id ? "Starting…" : `🎮 Play in ${g.name}`}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
