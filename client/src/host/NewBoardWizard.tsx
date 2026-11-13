// A new board: pick the event (its look and a sensible format), how it plays (from little
// pictures), and who plays (players, pairs or teams). All of it can change later in Setup.

import { useState } from "react";
import { EVENTS, FORMAT_NAMES, PRESETS, type FormatId } from "@leaderboard/shared";
import { api } from "../api";

const FORMAT_SHORT: Record<FormatId, string> = {
  points: "Trivia rounds, or a league of wins and losses",
  single: "Lose once and you're out",
  double: "Out after two losses",
  roundrobin: "Everyone plays everyone",
  ladder: "Beat someone above you to take their spot",
  best: "Highest score or fastest time wins",
};

type Who = "players" | "pairs" | "teams";

export function FormatPicture({ f }: { f: FormatId }) {
  const dim = "var(--fp-dim)";
  const hi = "var(--fp-hi)";
  const line = "var(--fp-line)";
  switch (f) {
    case "points":
      return (
        <svg viewBox="0 0 140 40" aria-hidden="true">
          <rect x="0" y="2" width="140" height="8" rx="3" fill={dim} />
          <rect x="0" y="16" width="110" height="8" rx="3" fill={dim} />
          <rect x="0" y="30" width="80" height="8" rx="3" fill={dim} />
          <rect x="0" y="2" width="22" height="8" rx="3" fill={hi} />
        </svg>
      );
    case "single":
      return (
        <svg viewBox="0 0 140 40" fill="none" strokeWidth="2.4" aria-hidden="true">
          <path d="M2 4h30v10H2M2 26h30v10H2M32 9v22M32 20h36" stroke={line} />
          <path d="M68 20h30" stroke={hi} />
          <circle cx="104" cy="20" r="6" fill={hi} />
        </svg>
      );
    case "double":
      return (
        <svg viewBox="0 0 140 40" fill="none" strokeWidth="2.4" aria-hidden="true">
          <path d="M2 3h24v8H2M26 7v6h24M50 13v14M50 20h30" stroke={line} />
          <path d="M2 29h24v8H2M26 33v-6h24" stroke="var(--fp-alt)" />
          <circle cx="86" cy="20" r="6" fill={hi} />
        </svg>
      );
    case "roundrobin":
      return (
        <svg viewBox="0 0 140 40" aria-hidden="true">
          {[0, 1, 2].flatMap((r) =>
            [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={c * 14} y={r * 14} width="12" height="12" rx="2" fill={r === c ? dim : line} />),
          )}
        </svg>
      );
    case "ladder":
      return (
        <svg viewBox="0 0 140 40" aria-hidden="true">
          <rect x="0" y="30" width="30" height="10" rx="2" fill={dim} />
          <rect x="34" y="20" width="30" height="20" rx="2" fill={dim} />
          <rect x="68" y="10" width="30" height="30" rx="2" fill={dim} />
          <rect x="102" y="0" width="30" height="40" rx="2" fill={hi} />
        </svg>
      );
    case "best":
      return (
        <svg viewBox="0 0 140 40" aria-hidden="true">
          <rect x="0" y="22" width="14" height="18" rx="2" fill={dim} />
          <rect x="18" y="8" width="14" height="32" rx="2" fill={hi} />
          <rect x="36" y="16" width="14" height="24" rx="2" fill={dim} />
          <rect x="54" y="28" width="14" height="12" rx="2" fill={dim} />
        </svg>
      );
  }
}

export function NewBoardWizard({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [event, setEvent] = useState<string>("");
  const [format, setFormat] = useState<FormatId>("points");
  const [who, setWho] = useState<Who>("players");
  const [title, setTitle] = useState("");
  const [edited, setEdited] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const autoTitle = (ev: string, w: Who) => {
    const e = EVENTS.find((x) => x.preset === ev);
    if (!e || !e.title) return "";
    return w === "pairs" && !/doubles/i.test(e.title) ? `${e.title} Doubles` : e.title;
  };
  const pickEvent = (id: string) => {
    const e = EVENTS.find((x) => x.preset === id)!;
    setEvent(id);
    setFormat(e.format);
    setWho(e.entry);
    if (!edited) setTitle(autoTitle(id, e.entry));
  };
  const pickWho = (w: Who) => {
    setWho(w);
    if (!edited) setTitle(autoTitle(event, w));
  };

  return (
    <form
      className="card wizard"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const v = await api.create({
            title,
            format,
            preset: event || undefined,
            entry: who === "players" ? { kind: "players", size: 0 } : { kind: "teams", size: who === "pairs" ? 2 : 0 },
          });
          onCreated(v.board.id);
        } catch (error) {
          setErr(error instanceof Error ? error.message : "That didn't work.");
          setBusy(false);
        }
      }}
    >
      <div className="wz-head">
        <h2>New board</h2>
        <button type="button" className="icon" aria-label="Cancel" onClick={onCancel}>
          ✕
        </button>
      </div>

      <p className="lab">What's the event?</p>
      <div className="event-grid">
        {EVENTS.map((e) => {
          const p = PRESETS.find((x) => x.id === e.preset);
          return (
            <button type="button" key={e.preset} className={`event-tile ${event === e.preset ? "on" : ""}`} aria-pressed={event === e.preset} onClick={() => pickEvent(e.preset)}>
              <span className="emoji" aria-hidden="true">
                {e.preset === "classic" ? "✨" : p?.theme.emoji}
              </span>
              {e.name}
            </button>
          );
        })}
      </div>

      <p className="lab">How does it play?</p>
      <div className="format-grid">
        {(Object.keys(FORMAT_NAMES) as FormatId[]).map((f) => (
          <button type="button" key={f} className={`format-card ${format === f ? "on" : ""}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
            <FormatPicture f={f} />
            <b>{FORMAT_NAMES[f]}</b>
            <small>{FORMAT_SHORT[f]}</small>
          </button>
        ))}
      </div>

      <p className="lab">Who's playing?</p>
      <div className="seg" role="group" aria-label="Who's playing">
        {(["players", "pairs", "teams"] as Who[]).map((w) => (
          <button type="button" key={w} className={who === w ? "on" : ""} aria-pressed={who === w} onClick={() => pickWho(w)}>
            {w === "players" ? "Players" : w === "pairs" ? "Pairs" : "Teams"}
          </button>
        ))}
      </div>

      <label>
        <span className="lab">Name</span>
        <input
          value={title}
          maxLength={60}
          onChange={(e) => {
            setTitle(e.target.value);
            setEdited(true);
          }}
          placeholder="Trivia Night"
          required
        />
      </label>
      <p className="muted small">You can change any of this later on the Setup tab.</p>
      {err && <p className="error">{err}</p>}
      <button className="primary wide big" disabled={busy || !title.trim()}>
        Next: who's playing
      </button>
    </form>
  );
}
