// "Who's here tonight?": tick regulars and last time's teams from earlier boards instead of
// typing them again.

import { useMemo, useState } from "react";
import { entrantLine, type BoardView, type PlayerSeen, type TeamSeen } from "@leaderboard/shared";
import { ago, namesOnBoard, Sheet, usePeople } from "./kit";
import type { Runner } from "./useActions";

type Filter = "event" | "recent" | "all";

export function RegularsSheet({ view, run, onClose }: { view: BoardView; run: Runner["run"]; onClose: () => void }) {
  const b = view.board;
  const teamsBoard = b.entry?.kind === "teams";
  const people = usePeople(b.id);
  const [filter, setFilter] = useState<Filter>("event");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const here = useMemo(() => namesOnBoard(view), [view]);
  const generic = b.theme.preset === "classic" || b.theme.preset === "custom";

  const keep = (p: PlayerSeen) => {
    if (q.trim() && !p.name.toLowerCase().includes(q.trim().toLowerCase()) && !(p as TeamSeen).members?.some((m) => m.toLowerCase().includes(q.trim().toLowerCase())))
      return false;
    if (filter === "event") return generic ? p.formats.includes(b.format) : p.presets.includes(b.theme.preset);
    if (filter === "recent") return p.lastAt >= Date.now() - 28 * 86_400_000;
    return true;
  };
  // Who could still come in first; those already on the board last.
  const later = (x: PlayerSeen, y: PlayerSeen) => Number(here.has(x.name.toLowerCase())) - Number(here.has(y.name.toLowerCase()));
  const teams = teamsBoard ? (people?.teams ?? []).filter(keep).sort(later) : [];
  const players = (people?.players ?? []).filter(keep).sort(later);
  const key = (kind: "t" | "p", name: string) => `${kind}:${name.toLowerCase()}`;
  const toggle = (k: string) => {
    const n = new Set(picked);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setPicked(n);
  };
  const pickedTeams = (people?.teams ?? []).filter((t) => picked.has(key("t", t.name)));
  const teamMembers = new Set(pickedTeams.flatMap((t) => t.members.map((m) => m.toLowerCase())));
  const pickedPlayers = (people?.players ?? []).filter((p) => picked.has(key("p", p.name)) && !teamMembers.has(p.name.toLowerCase()));

  const label = (() => {
    const parts: string[] = [];
    if (pickedTeams.length) parts.push(`${pickedTeams.length} ${b.entry.size === 2 ? (pickedTeams.length === 1 ? "pair" : "pairs") : pickedTeams.length === 1 ? "team" : "teams"}`);
    if (pickedPlayers.length) parts.push(`${pickedPlayers.length} ${pickedPlayers.length === 1 ? "player" : "players"}`);
    return parts.length ? `Add ${parts.join(" and ")}` : "Tick who's here";
  })();

  const add = async () => {
    setBusy(true);
    let ok = true;
    if (pickedPlayers.length) {
      const names = pickedPlayers.map((p) => p.name);
      ok = teamsBoard
        ? await run((v) => ({
            type: "arrange",
            teams: v.board.participants.map((p) => ({ id: p.id, name: p.name, members: p.members ?? [] })),
            waiting: [...(v.board.waiting ?? []), ...names.filter((n) => !namesOnBoard(v).has(n.toLowerCase()))],
          }))
        : await run({ type: "addParticipants", names: [names.map((n) => entrantLine({ name: n })).join("\n")] });
    }
    if (ok && pickedTeams.length) ok = await run({ type: "addParticipants", names: [pickedTeams.map((t) => entrantLine(t)).join("\n")] });
    setBusy(false);
    if (ok) onClose();
  };

  const Row = ({ k, title, sub, on, disabled }: { k: string; title: string; sub: string; on: boolean; disabled?: boolean }) => (
    <li>
      <button className={`pick-row ${on ? "on" : ""}`} disabled={disabled} aria-pressed={on} onClick={() => toggle(k)}>
        <span className="box" aria-hidden="true">
          {on || disabled ? "✓" : ""}
        </span>
        <span className="what">
          <b>{title}</b>
          <small>{sub}</small>
        </span>
      </button>
    </li>
  );

  return (
    <Sheet
      title="Who's here tonight?"
      onClose={onClose}
      footer={
        <button className="primary wide big" disabled={busy || (!pickedTeams.length && !pickedPlayers.length)} onClick={add}>
          {label}
        </button>
      }
    >
      <input type="search" maxLength={40} placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search names" />
      <div className="seg" role="group" aria-label="Show">
        <button className={filter === "event" ? "on" : ""} onClick={() => setFilter("event")}>
          {generic ? "This format" : "This kind of night"}
        </button>
        <button className={filter === "recent" ? "on" : ""} onClick={() => setFilter("recent")}>
          Last 4 weeks
        </button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          Everyone
        </button>
      </div>
      {!people && <p className="muted">Loading…</p>}
      {people && !teams.length && !players.length && (
        <p className="empty">{people.players.length ? "Nobody matches. Try Everyone." : "Nobody yet: names show up here once boards have been played."}</p>
      )}
      {teams.length > 0 && (
        <>
          <p className="lab">{b.entry.size === 2 ? "Pairs" : "Teams"} from earlier boards</p>
          <ul className="pick-list">
            {teams.map((t) => {
              const on = here.has(t.name.toLowerCase());
              return (
                <Row
                  key={t.name}
                  k={key("t", t.name)}
                  title={t.name}
                  on={picked.has(key("t", t.name))}
                  disabled={on}
                  sub={on ? "on the board" : `${t.members.join(" & ")} · ${t.won ? `won ${t.won} · ` : ""}last ${ago(t.lastAt)}`}
                />
              );
            })}
          </ul>
        </>
      )}
      {players.length > 0 && (
        <>
          <p className="lab">Players</p>
          <ul className="pick-list">
            {players.map((p) => {
              const on = here.has(p.name.toLowerCase());
              const inTeam = teamMembers.has(p.name.toLowerCase());
              return (
                <Row
                  key={p.name}
                  k={key("p", p.name)}
                  title={p.name}
                  on={picked.has(key("p", p.name)) || inTeam}
                  disabled={on || inTeam}
                  sub={on ? "on the board" : inTeam ? "coming with their team" : `played ${p.times} ${p.times === 1 ? "time" : "times"} · last ${ago(p.lastAt)}`}
                />
              );
            })}
          </ul>
        </>
      )}
      <p className="muted small">People are matched by name, so "Alex" and "Alex B." show as two people.</p>
    </Sheet>
  );
}
