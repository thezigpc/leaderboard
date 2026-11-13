// Blind draw: everyone into random teams. Lock a team to keep it on the next draw (teams
// that came in together start locked); the odd one out sits out or joins a team.

import { useMemo, useState } from "react";
import { TEAM_NAMES, type BoardView } from "@leaderboard/shared";
import { Sheet } from "./kit";
import type { Runner } from "./useActions";

interface Drawn {
  key: string;
  /** An existing team kept as it is. */
  id?: string;
  name: string;
  members: string[];
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function DrawSheet({ view, run, onClose }: { view: BoardView; run: Runner["run"]; onClose: () => void }) {
  const b = view.board;
  // Teams that came in together (and teams with no players yet) start locked; everyone else goes in the hat.
  const initialLocked: Drawn[] = b.participants.filter((p) => (p.members?.length ?? 0) !== 1).map((p) => ({ key: p.id, id: p.id, name: p.name, members: [...(p.members ?? [])] }));
  const hat = useMemo(
    () => [...(b.waiting ?? []), ...b.participants.filter((p) => (p.members?.length ?? 0) === 1).flatMap((p) => p.members ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [size, setSize] = useState(Math.max(2, b.entry?.size || 2));
  const [odd, setOdd] = useState<"join" | "out">("join");
  const [names, setNames] = useState<"theirs" | "made">("made");
  const [locked, setLocked] = useState<Drawn[]>(initialLocked);
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState(false);

  const { drawn, out } = useMemo(() => {
    const lockedNames = new Set(locked.flatMap((t) => t.members.map((m) => m.toLowerCase())));
    const pool = shuffle([...hat, ...initialLocked.filter((t) => !locked.some((l) => l.key === t.key)).flatMap((t) => t.members)].filter((n) => !lockedNames.has(n.toLowerCase())));
    const groups: string[][] = [];
    for (let i = 0; i + size <= pool.length; i += size) groups.push(pool.slice(i, i + size));
    const rest = pool.slice(groups.length * size);
    let out: string[] = [];
    if (rest.length) {
      if (odd === "out" && groups.length) out = rest;
      else if (!groups.length) groups.push(rest);
      else rest.forEach((r, i) => groups[groups.length - 1 - (i % groups.length)].push(r));
    }
    const used = new Set([...locked.map((t) => t.name.toLowerCase())]);
    const made = shuffle(TEAM_NAMES.filter((n) => !used.has(n.toLowerCase())));
    const drawn: Drawn[] = groups.map((g, i) => {
      let name = names === "made" && made[i] ? made[i] : g.join(" & ").slice(0, 40);
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name.slice(0, 36)} ${k}`;
      used.add(name.toLowerCase());
      return { key: `d${seed}-${i}`, name, members: g };
    });
    return { drawn, out };
    // seed: "Draw again"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hat, size, odd, names, locked, seed]);

  const total = hat.length + initialLocked.reduce((n, t) => n + t.members.length, 0);
  const all = [...locked, ...drawn];

  const use = async () => {
    setBusy(true);
    const ok = await run({ type: "arrange", teams: all.map((t) => ({ ...(t.id ? { id: t.id } : {}), name: t.name, members: t.members })), waiting: out });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title="Blind draw"
      onClose={onClose}
      footer={
        <div className="two">
          <button onClick={() => setSeed((s) => s + 1)}>🎲 Draw again</button>
          <button className="primary" disabled={busy || !all.length} onClick={use}>
            Use these teams
          </button>
        </div>
      }
    >
      <p className="muted">{total} players into random teams.</p>
      <div className="set-row">
        <span>Players per team</span>
        <div className="stepper">
          <button aria-label="Fewer" disabled={size <= 2} onClick={() => setSize(size - 1)}>
            −
          </button>
          <b>{size}</b>
          <button aria-label="More" disabled={size >= 8} onClick={() => setSize(size + 1)}>
            +
          </button>
        </div>
      </div>
      <div className="set-row">
        <span>The odd one out</span>
        <div className="seg">
          <button className={odd === "out" ? "on" : ""} onClick={() => setOdd("out")}>
            Sits out
          </button>
          <button className={odd === "join" ? "on" : ""} onClick={() => setOdd("join")}>
            Joins a team
          </button>
        </div>
      </div>
      <div className="set-row">
        <span>Team names</span>
        <div className="seg">
          <button className={names === "theirs" ? "on" : ""} onClick={() => setNames("theirs")}>
            Their names
          </button>
          <button className={names === "made" ? "on" : ""} onClick={() => setNames("made")}>
            Made up
          </button>
        </div>
      </div>
      <p className="lab">
        The draw · {all.length} {all.length === 1 ? "team" : "teams"} <span className="muted">· lock a team to keep it</span>
      </p>
      <ol className="draw-list">
        {all.map((t, i) => {
          const isLocked = locked.some((l) => l.key === t.key);
          return (
            <li key={t.key} className={isLocked ? "locked" : ""}>
              <span className="n">{i + 1}</span>
              <span className="what">
                <b>{t.members.join(" & ") || t.name}</b>
                <small>
                  {t.name}
                  {t.members.length !== size ? ` · ${t.members.length} players` : ""}
                  {isLocked ? " · kept together" : ""}
                </small>
              </span>
              <button
                className="icon"
                aria-pressed={isLocked}
                aria-label={isLocked ? `Unlock ${t.name}` : `Lock ${t.name}`}
                onClick={() => setLocked(isLocked ? locked.filter((l) => l.key !== t.key) : [...locked, t])}
              >
                {isLocked ? "🔒" : "🔓"}
              </button>
            </li>
          );
        })}
        {out.map((o) => (
          <li key={o} className="out">
            <span className="n">–</span>
            <span className="what">
              <b>{o}</b>
              <small>sits out (stays waiting)</small>
            </span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
