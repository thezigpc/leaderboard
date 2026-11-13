// The standings table: places, names, the format's columns, the headline value.
// Rows that just changed glow for a moment.

import { useEffect, useRef, useState } from "react";
import { groupName, type BoardView, type StandingRow } from "@leaderboard/shared";
import { formatTime, valueText } from "./format";

export function headline(view: BoardView): string | null {
  const b = view.board;
  switch (b.format) {
    case "points":
      return b.settings.points.scoring === "matches" ? "Pts" : "Total";
    case "roundrobin":
      return "Pts";
    case "best":
      return b.settings.best.label || "Best";
    default:
      return null;
  }
}

/** Ids whose row changed since the last render (value, place or cells). */
function useChanged(rows: StandingRow[]): Set<string> {
  const prev = useRef(new Map<string, string>());
  const [changed, setChanged] = useState(new Set<string>());
  useEffect(() => {
    const next = new Map(rows.map((r) => [r.id, JSON.stringify([r.place, r.value, r.cells])]));
    const diff = new Set<string>();
    if (prev.current.size) for (const [id, sig] of next) if (prev.current.get(id) !== sig) diff.add(id);
    prev.current = next;
    if (!diff.size) return;
    setChanged(diff);
    const t = setTimeout(() => setChanged(new Set()), 4000);
    return () => clearTimeout(t);
  }, [rows]);
  return changed;
}

export function StandingsTable({
  view,
  rows,
  follow,
  compact,
  hideColumns,
  onRow,
}: {
  view: BoardView;
  rows?: StandingRow[];
  follow?: string;
  compact?: boolean;
  hideColumns?: boolean;
  onRow?: (r: StandingRow) => void;
}) {
  const list = rows ?? view.derived.standings;
  const changed = useChanged(list);
  const cols = hideColumns ? [] : view.derived.columns;
  const head = headline(view);
  const bracket = view.board.format === "single" || view.board.format === "double";
  return (
    <table className={`standings ${compact ? "compact" : ""}`}>
      <thead>
        <tr>
          <th className="place">#</th>
          <th className="name">{view.board.participants.some((p) => p.members?.length) ? "Team" : "Name"}</th>
          {cols.map((c) => (
            <th key={c.key} className="num">
              {c.label}
            </th>
          ))}
          {head && <th className="num total">{head}</th>}
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr
            key={r.id}
            className={`${r.out ? "out" : ""} ${changed.has(r.id) ? "flash" : ""} ${follow === r.id ? "me" : ""} ${r.place === 1 && !r.out ? "first" : ""}`}
            onClick={onRow ? () => onRow(r) : undefined}
          >
            <td className="place">{r.place ? r.place : bracket && !r.out ? "•" : "–"}</td>
            <td className="name">
              {r.name}
              {r.out && bracket && <span className="tag">out</span>}
            </td>
            {cols.map((c) => {
              const v = r.cells[c.key];
              return (
                <td key={c.key} className="num">
                  {v === null || v === undefined ? "" : c.type === "time" && typeof v === "number" ? formatTime(v) : String(v)}
                </td>
              );
            })}
            {head && <td className="num total">{valueText(view, r.value)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Round robin with groups: one table per group. */
export function GroupTables({ view, follow, compact }: { view: BoardView; follow?: string; compact?: boolean }) {
  const groups = view.derived.groupStandings;
  if (!groups) return <StandingsTable view={view} follow={follow} compact={compact} />;
  return (
    <div className="groups">
      {groups.map((rows, i) => (
        <section key={i} className="group">
          <h3>Group {groupName(i)}</h3>
          <StandingsTable view={view} rows={rows} follow={follow} compact={compact} />
        </section>
      ))}
    </div>
  );
}
