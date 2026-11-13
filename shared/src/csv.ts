// CSV export of a board: the standings, then every played match.

import { derive } from "./derive.js";
import { FORMAT_NAMES } from "./defaults.js";
import type { Board, DerivedBoard } from "./types.js";

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  // Spreadsheet formula injection: a leading = + - @ is made literal.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (cells: unknown[]) => cells.map(cell).join(",");

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m ? `${m}:${s.toFixed(2).padStart(5, "0")}` : s.toFixed(2);
}

export function boardCsv(b: Board, d: DerivedBoard = derive(b)): string {
  const names = new Map(b.participants.map((p) => [p.id, p.name]));
  const rows: string[] = [];
  rows.push(line([b.title, FORMAT_NAMES[b.format], b.status, b.winners?.length ? `Winner: ${b.winners.join(" & ")}` : ""]));
  rows.push("");
  const time = b.format === "best" && b.settings.best.unit === "time";
  rows.push(line(["Place", "Name", "Members", ...d.columns.map((c) => c.label), b.format === "best" ? b.settings.best.label : "Total"]));
  const members = new Map(b.participants.map((p) => [p.id, p.members?.join("; ") ?? ""]));
  for (const r of d.standings) {
    const fmt = (v: unknown, t?: string) => (t === "time" && typeof v === "number" ? formatTime(v) : v);
    rows.push(
      line([
        r.place || (r.out ? "out" : ""),
        r.name,
        members.get(r.id) ?? "",
        ...d.columns.map((c) => fmt(r.cells[c.key], c.type)),
        time ? formatTime(r.value) : r.value ?? "",
      ]),
    );
  }
  const played = d.matches.filter((m) => m.state === "done" && m.result);
  if (played.length) {
    rows.push("");
    rows.push(line(["Match", "A", "B", "Score A", "Score B", "Winner", "Note"]));
    for (const m of played) {
      const r = m.result!;
      const swap = m.a.kind === "player" && r.a !== m.a.id;
      rows.push(
        line([
          m.label,
          names.get(r.a),
          names.get(r.b),
          swap ? r.scoreB : r.scoreA,
          swap ? r.scoreA : r.scoreB,
          r.winner ? names.get(r.winner) : "Draw",
          r.forfeit ? "Walkover" : "",
        ]),
      );
    }
  }
  if (b.format === "best" && b.attempts.length) {
    rows.push("");
    rows.push(line(["Attempt", "Name", b.settings.best.label]));
    b.attempts.forEach((a, i) => rows.push(line([i + 1, names.get(a.pid), time ? formatTime(a.value) : a.value])));
  }
  return rows.join("\r\n") + "\r\n";
}
