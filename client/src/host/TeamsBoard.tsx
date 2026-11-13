// Teams as cards. On a phone: tap a player, then tap a team (or another waiting player to
// pair them up). On a wide screen players can also be dragged between teams.
// Every change sends the whole arrangement, built from the latest board.

import { useState } from "react";
import type { BoardView, PublicBoard } from "@leaderboard/shared";
import { DrawSheet } from "./DrawSheet";
import { namesOnBoard, useDrag, type DragItem } from "./kit";
import type { Runner } from "./useActions";

type Team = { id?: string; name: string; members: string[] };
type Arrangement = { teams: Team[]; waiting: string[] };
type Picked = { name: string; from: string } | null; // from: "waiting" or a team id

const arrangementOf = (b: PublicBoard): Arrangement => ({
  teams: b.participants.map((p) => ({ id: p.id, name: p.name, members: [...(p.members ?? [])] })),
  waiting: [...(b.waiting ?? [])],
});

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Takes a player out of wherever they are. */
function without(a: Arrangement, name: string): Arrangement {
  return {
    teams: a.teams.map((t) => ({ ...t, members: t.members.filter((m) => !same(m, name)) })),
    waiting: a.waiting.filter((w) => !same(w, name)),
  };
}

export function TeamsBoard({ view, run, wide }: { view: BoardView; run: Runner["run"]; wide: boolean }) {
  const b = view.board;
  const draft = b.status === "draft";
  const size = b.entry?.size ?? 0;
  const pairs = size === 2;
  const canAddTeams = draft || !(b.format === "single" || b.format === "double" || b.format === "roundrobin");
  const [picked, setPicked] = useState<Picked>(null);
  const [newPlayer, setNewPlayer] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [err, setErr] = useState("");
  const cur = arrangementOf(b);

  const change = (f: (a: Arrangement, v: BoardView) => Arrangement | null) =>
    run((v) => {
      const next = f(arrangementOf(v.board), v);
      return next ? { type: "arrange", teams: next.teams, waiting: next.waiting } : null;
    });

  const moveTo = (name: string, target: string) => {
    setPicked(null);
    void change((a) => {
      const n = without(a, name);
      if (target === "waiting") n.waiting.push(name);
      else {
        const t = n.teams.find((x) => x.id === target);
        if (!t) return null;
        t.members.push(name);
      }
      return n;
    });
  };

  const pairUp = (x: string, y: string) => {
    setPicked(null);
    void change((a) => {
      const n = without(without(a, x), y);
      let name = `${x} & ${y}`.slice(0, 40);
      for (let i = 2; n.teams.some((t) => same(t.name, name)); i++) name = `${x} & ${y} ${i}`.slice(0, 40);
      n.teams.push({ name, members: [x, y] });
      return n;
    });
  };

  const tapWaiting = (name: string) => {
    if (picked && same(picked.name, name)) return setPicked(null);
    if (picked && picked.from === "waiting" && canAddTeams) return pairUp(picked.name, name);
    setPicked({ name, from: "waiting" });
  };
  const tapMember = (team: string, name: string) => {
    if (picked && same(picked.name, name)) return setPicked(null);
    setPicked({ name, from: team });
  };
  const tapTeam = (id: string) => {
    if (picked && picked.from !== id) moveTo(picked.name, id);
  };

  const { bind, ghost, over, dragging } = useDrag(wide, (item: DragItem, target: string) => {
    if (target === "waiting") moveTo(item.id, "waiting");
    else if (target.startsWith("team:")) moveTo(item.id, target.slice(5));
  });

  const taken = namesOnBoard(view);
  const addPlayer = async () => {
    const name = newPlayer.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (taken.has(name.toLowerCase())) return setErr(`${name} is already on this board.`);
    setErr("");
    if (await change((a) => ({ ...a, waiting: [...a.waiting, name] }))) setNewPlayer("");
  };
  const addTeam = async () => {
    const name = newTeam.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (b.participants.some((p) => same(p.name, name))) return setErr(`There's already a team called ${name}.`);
    setErr("");
    const who = picked?.name;
    setPicked(null);
    const ok = await change((a) => {
      const n = who ? without(a, who) : a;
      n.teams.push({ name, members: who ? [who] : [] });
      return n;
    });
    if (ok) setNewTeam("");
  };

  const full = cur.teams.filter((t) => size && t.members.length >= size).length;
  const chip = (name: string, from: string) => {
    const on = !!picked && same(picked.name, name);
    return (
      <button
        key={name}
        className={`pchip ${on ? "sel" : ""} ${dragging === name ? "dragging" : ""}`}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          if (from === "waiting") tapWaiting(name);
          else tapMember(from, name);
        }}
        {...bind({ id: name, label: name })}
      >
        {name}
      </button>
    );
  };

  return (
    <div className="teams-board">
      <div className={`waiting-tray ${over === "waiting" ? "over" : ""} ${picked && picked.from !== "waiting" ? "target" : ""}`} data-drop="waiting" onClick={() => picked && picked.from !== "waiting" && moveTo(picked.name, "waiting")}>
        <p className="lab">Waiting for a team · {cur.waiting.length}</p>
        <div className="chip-row">
          {cur.waiting.map((w) => chip(w, "waiting"))}
          <form
            className="inline-add"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void addPlayer();
            }}
          >
            <input value={newPlayer} maxLength={40} autoCapitalize="words" enterKeyHint="next" placeholder="+ Player" aria-label="Add a player" onChange={(e) => setNewPlayer(e.target.value)} />
          </form>
        </div>
        {picked ? (
          <p className="hint-line">
            {picked.from === "waiting"
              ? `${picked.name} is picked. Tap a team to put ${picked.name} on it${canAddTeams ? ", or another waiting player to pair them up" : ""}.`
              : `${picked.name} is picked. Tap another team, or tap here to take ${picked.name} off the team.`}
          </p>
        ) : cur.waiting.length ? (
          <p className="hint-line muted">Tap a player, then tap their team.{wide ? " Or drag them." : ""}</p>
        ) : null}
      </div>
      {err && <p className="error">{err}</p>}

      <p className="lab">
        {cur.teams.length} {pairs ? (cur.teams.length === 1 ? "pair" : "pairs") : cur.teams.length === 1 ? "team" : "teams"}
        {size ? ` · ${full} full` : ""}
      </p>
      <div className="team-grid">
        {cur.teams.map((t) => {
          const id = t.id!;
          const isTarget = !!picked && picked.from !== id;
          const count = t.members.length;
          const p = b.participants.find((x) => x.id === id);
          return (
            <div
              key={id}
              className={`team-card ${isTarget ? "target" : ""} ${over === `team:${id}` ? "over" : ""} ${p?.withdrawn ? "out" : ""}`}
              data-drop={`team:${id}`}
              onClick={() => tapTeam(id)}
            >
              <div className="tc-head">
                <button
                  className="tc-name"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTarget) return tapTeam(id);
                    const name = window.prompt("Team name", t.name);
                    if (name && name.trim() && name !== t.name) void run({ type: "editParticipant", id, name });
                  }}
                >
                  {t.name}
                </button>
                {size > 0 && <span className={`tc-count ${count >= size ? (count > size ? "over" : "full") : ""}`}>{`${count} of ${size}`}</span>}
                {draft && (
                  <button
                    className="icon"
                    aria-label={`Remove ${t.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void change((a) => ({ teams: a.teams.filter((x) => x.id !== id), waiting: [...a.waiting, ...(a.teams.find((x) => x.id === id)?.members ?? [])] }));
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="chip-row">
                {t.members.map((m) => (
                  <span key={m} className="member">
                    {chip(m, id)}
                    <button
                      className="mx"
                      aria-label={`Take ${m} off ${t.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveTo(m, "waiting");
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {isTarget && (!size || count < size) ? (
                  <span className="slot put">Put {picked!.name} here</span>
                ) : (
                  size > count && Array.from({ length: Math.min(size - count, 4) }, (_, i) => <span key={i} className="slot">Empty</span>)
                )}
              </div>
            </div>
          );
        })}
        {canAddTeams && (
          <form
            className="team-card new"
            onSubmit={(e) => {
              e.preventDefault();
              void addTeam();
            }}
          >
            <input value={newTeam} maxLength={40} autoCapitalize="words" placeholder={picked ? `New team with ${picked.name}` : "+ New team"} aria-label="New team name" onChange={(e) => setNewTeam(e.target.value)} />
            {newTeam.trim() && <button className="primary">Add</button>}
          </form>
        )}
      </div>
      {draft && (cur.waiting.length > 1 || cur.teams.length > 1) && (
        <button className="wide" onClick={() => setDrawing(true)}>
          🎲 Blind draw: make random teams
        </button>
      )}
      {drawing && <DrawSheet view={view} run={run} onClose={() => setDrawing(false)} />}
      {ghost}
    </div>
  );
}
