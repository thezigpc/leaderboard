// A season board's own tools: add a night that wasn't run on a board here (paste a trivia
// night's results), remove one, and say that two spellings are the same team so the season
// doesn't split them.

import { useMemo, useState } from "react";
import { nameKey, readNight, similarNames, type BoardView, type SeasonLink, type SeasonNight } from "@leaderboard/shared";
import { Sheet } from "./kit";
import type { Runner } from "./useActions";

const EMPTY: SeasonLink = { boards: [], scoring: "placement", placePoints: [10, 8, 6, 5, 4, 3, 2, 1] };
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
/** Tonight and the four weeks before, as "YYYY-MM-DD" in local time, for the night's date. A
 * dropdown, not a date picker: Chromium's calendar pop-up can't be reached by touch on the
 * box's own screens (the kit's on-screen keyboard shows a dropdown as big buttons). */
function recentDays(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 29; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const name = day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    out.push({ value, label: i === 0 ? `Tonight (${name})` : i === 1 ? `Yesterday (${name})` : name });
  }
  return out;
}

export function SeasonTools({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const season = view.board.season ?? EMPTY;
  const [adding, setAdding] = useState(false);
  const save = (patch: Partial<SeasonLink>) => run({ type: "season", season: { ...season, ...patch } });
  // Names the season already counts (after aliases), to match a new night against.
  const known = useMemo(() => view.board.participants.map((p) => p.name), [view.board.participants]);
  const pairs = useMemo(() => {
    const out: [string, string][] = [];
    const seen = new Set<string>();
    for (const n of known) {
      for (const other of similarNames(n, known, 1)) {
        const key = [n, other].map(nameKey).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([n, other]);
      }
    }
    return out.slice(0, 8);
  }, [known]);
  const aliases = Object.entries(season.aliases ?? {});

  return (
    <div className="season-tools">
      <div className="row-between">
        <h3>Nights</h3>
        <button className="primary" onClick={() => setAdding(true)}>
          + Add a night's results
        </button>
      </div>
      {!(season.nights?.length ?? 0) && <p className="muted small">Paste a night's results from another game (a trivia night's final scores), or link boards run here in Setup.</p>}
      <ul className="night-list">
        {(season.nights ?? [])
          .slice()
          .sort((x, y) => x.at - y.at)
          .map((n) => (
            <li key={n.id}>
              <span>
                <b>{n.title}</b> <span className="muted small">{new Date(n.at).toLocaleDateString()} · {n.results.length} teams · 1st {n.results.find((r) => r.place === 1)?.name ?? "?"}</span>
              </span>
              <button className="link danger" onClick={() => window.confirm(`Remove ${n.title} from the season?`) && save({ nights: (season.nights ?? []).filter((x) => x.id !== n.id) })}>
                Remove
              </button>
            </li>
          ))}
      </ul>

      {(pairs.length > 0 || aliases.length > 0) && <h3>Same team, other spelling?</h3>}
      {pairs.map(([a, b]) => (
        <div className="alias-row" key={a + b}>
          <span>
            <b>{a}</b> and <b>{b}</b>
          </span>
          <span className="chips">
            <button onClick={() => save({ aliases: { ...season.aliases, [nameKey(a)]: b } })}>Count as {b}</button>
            <button onClick={() => save({ aliases: { ...season.aliases, [nameKey(b)]: a } })}>Count as {a}</button>
          </span>
        </div>
      ))}
      {aliases.map(([from, to]) => (
        <div className="alias-row" key={from}>
          <span className="muted">
            “{from}” counts as <b>{to}</b>
          </span>
          <button
            className="link"
            onClick={() => {
              const next = { ...season.aliases };
              delete next[from];
              void save({ aliases: next });
            }}
          >
            Undo
          </button>
        </div>
      ))}

      {adding && (
        <AddNight
          known={known}
          lowWins={view.board.settings.points.order === "low"}
          onClose={() => setAdding(false)}
          onSave={async (night, newAliases) => {
            const ok = await save({ nights: [...(season.nights ?? []), night], aliases: { ...season.aliases, ...newAliases } });
            if (ok) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddNight({
  known,
  lowWins,
  onClose,
  onSave,
}: {
  known: string[];
  lowWins: boolean;
  onClose: () => void;
  onSave: (n: SeasonNight, aliases: Record<string, string>) => void;
}) {
  const [title, setTitle] = useState("");
  const days = useMemo(recentDays, []);
  const [date, setDate] = useState(days[0].value);
  const [text, setText] = useState("");
  // Per pasted name: the existing name it should count as ("" keeps it new).
  const [as, setAs] = useState<Record<string, string>>({});
  const rows = useMemo(() => readNight(text, lowWins), [text, lowWins]);
  const knownKeys = useMemo(() => new Set(known.map(nameKey)), [known]);
  const at = new Date(`${date}T20:00:00`).getTime();
  const save = () => {
    const aliases: Record<string, string> = {};
    for (const r of rows) if (as[r.name]) aliases[nameKey(r.name)] = as[r.name];
    onSave({ id: newId(), title: title.trim() || new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }), at: Number.isFinite(at) ? at : Date.now(), results: rows }, aliases);
  };
  return (
    <Sheet
      title="Add a night's results"
      onClose={onClose}
      footer={
        <button className="primary wide" disabled={!rows.length} onClick={save}>
          Add {rows.length || ""} {rows.length === 1 ? "team" : "teams"}
        </button>
      }
    >
      <label>
        Name (optional)
        <input value={title} maxLength={40} placeholder="Week 3" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Date
        <select value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Results, best first: one team per line
        <textarea rows={7} maxLength={8000} value={text} placeholder={"1. Quizzards 52\n2. Brainiacs 40\n3. Table Six 31"} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="muted small">A number before the name is the place, a number after it the score. Without places, the higher score wins{lowWins ? " (lower, on this board)" : ""}.</p>
      {rows.length > 0 && (
        <ol className="night-preview">
          {rows.map((r) => {
            const near = knownKeys.has(nameKey(r.name)) ? [] : similarNames(r.name, known, 2);
            return (
              <li key={r.name}>
                <span className="place">{r.place}</span>
                <span className="who">
                  {r.name}
                  {knownKeys.has(nameKey(r.name)) && <small className="muted"> (returning)</small>}
                </span>
                {r.score !== undefined && <span className="score">{r.score}</span>}
                {near.length > 0 && (
                  <span className="near chips">
                    {near.map((n) => (
                      <button key={n} className={as[r.name] === n ? "on" : ""} onClick={() => setAs({ ...as, [r.name]: as[r.name] === n ? "" : n })}>
                        Same as {n}?
                      </button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
