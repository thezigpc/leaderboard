// The "Setup" tab: name, format and its rules, lanes, the event theme, the scorekeeper PIN,
// season links, finishing, templates and deleting.

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FORMAT_HINTS, FORMAT_NAMES, PRESETS, type BoardSummary, type BoardView, type CustomPreset, type FormatId, type Theme, type TitleStyle } from "@leaderboard/shared";
import { api, csvUrl, uploadUrl } from "../api";
import type { Runner } from "./useActions";

function Section({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card setup-section" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function TextSetting({ label, value, onSave, max }: { label: string; value: string; onSave: (v: string) => void; max: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label>
      {label}
      <input value={v} maxLength={max} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function NumSetting({ label, value, onSave, min, max, step = 1 }: { label: string; value: number; onSave: (v: number) => void; min: number; max: number; step?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="inline">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => Number(v) !== value && v.trim() !== "" && onSave(Number(v))}
      />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

function FormatRules({ view, run }: { view: BoardView; run: Runner["run"] }) {
  const b = view.board;
  const s = b.settings;
  const set = (patch: unknown) => run({ type: "settings", settings: patch });
  const draft = b.status === "draft";
  switch (b.format) {
    case "points": {
      const p = s.points;
      return (
        <>
          <label>
            Scoring
            <select value={p.scoring} onChange={(e) => set({ points: { scoring: e.target.value } })}>
              <option value="rounds">Scores per round (trivia)</option>
              <option value="matches">Wins, draws and losses (a league)</option>
            </select>
          </label>
          {p.scoring === "rounds" ? (
            <>
              <label>
                Rounds (comma-separated)
                <RoundsEditor rounds={p.rounds} onSave={(rounds) => set({ points: { rounds } })} />
              </label>
              <label>
                Who wins
                <select value={p.order} onChange={(e) => set({ points: { order: e.target.value } })}>
                  <option value="high">Highest total</option>
                  <option value="low">Lowest total</option>
                </select>
              </label>
              <label>
                Ties are broken by
                <select value={p.tiebreaks.join(",")} onChange={(e) => set({ points: { tiebreaks: e.target.value ? e.target.value.split(",") : [] } })}>
                  <option value="lastRound,bestRound">The last round, then the best round</option>
                  <option value="bestRound,lastRound">The best round, then the last round</option>
                  <option value="mostRoundWins,lastRound">Most rounds won, then the last round</option>
                  <option value="">Nothing: tied teams share the place</option>
                </select>
              </label>
            </>
          ) : (
            <PointsFor value={p} onSave={(v) => set({ points: v })} />
          )}
        </>
      );
    }
    case "single":
    case "double": {
      const k = b.format;
      const bs = s[k];
      return (
        <>
          <label className="inline">
            Matches are best of
            <select value={bs.bestOf} onChange={(e) => set({ [k]: { bestOf: Number(e.target.value) } })}>
              {[1, 3, 5, 7, 9].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {k === "single" && <Check label="Third-place match" value={bs.thirdPlace} onChange={(v) => set({ single: { thirdPlace: v } })} />}
          {k === "double" && <Check label="Bracket reset: the winners-bracket champion has to lose twice" value={bs.bracketReset} onChange={(v) => set({ double: { bracketReset: v } })} />}
          <p className="muted small">Byes go to the top seeds when the number of entrants isn't a power of two. Seed order is on the Entrants tab.</p>
        </>
      );
    }
    case "roundrobin": {
      const r = s.roundrobin;
      return (
        <>
          {draft ? (
            <>
              <NumSetting label="Groups" value={r.groups} min={1} max={16} onSave={(v) => set({ roundrobin: { groups: v } })} />
              <label className="inline">
                Everyone plays each other
                <select value={r.legs} onChange={(e) => set({ roundrobin: { legs: Number(e.target.value) } })}>
                  <option value={1}>once</option>
                  <option value={2}>twice</option>
                </select>
              </label>
            </>
          ) : (
            <p className="muted small">
              {r.groups} group{r.groups === 1 ? "" : "s"}, {r.legs === 2 ? "twice" : "once"} each (fixed once started).
            </p>
          )}
          <Check label="Draws allowed" value={r.allowDraws} onChange={(v) => set({ roundrobin: { allowDraws: v } })} />
          <PointsFor value={r} onSave={(v) => set({ roundrobin: v })} />
          <NumSetting label="Go through to a knockout, per group" value={r.advance} min={0} max={16} onSave={(v) => set({ roundrobin: { advance: v } })} />
        </>
      );
    }
    case "ladder":
      return (
        <>
          <NumSetting label="Challenge up to this many places above (0: anyone)" value={s.ladder.reach} min={0} max={50} onSave={(v) => set({ ladder: { reach: v } })} />
          <p className="muted small">The starting order is the seed order on the Entrants tab. A challenger who wins takes the defender's place; everyone between moves down one.</p>
        </>
      );
    case "best":
      return (
        <>
          <TextSetting label="What's measured" value={s.best.label} max={20} onSave={(v) => set({ best: { label: v } })} />
          <label>
            Unit
            <select value={s.best.unit} onChange={(e) => set({ best: { unit: e.target.value, order: e.target.value === "time" ? "low" : s.best.order } })}>
              <option value="points">Points</option>
              <option value="time">Time (fastest)</option>
              <option value="number">Number</option>
            </select>
          </label>
          <label>
            Who wins
            <select value={s.best.order} onChange={(e) => set({ best: { order: e.target.value } })}>
              <option value="high">Highest</option>
              <option value="low">Lowest</option>
            </select>
          </label>
          <NumSetting label="Attempts each (0: unlimited)" value={s.best.maxAttempts} min={0} max={100} onSave={(v) => set({ best: { maxAttempts: v } })} />
        </>
      );
  }
}

function PointsFor({ value, onSave }: { value: { win: number; draw: number; loss: number }; onSave: (v: { win?: number; draw?: number; loss?: number }) => void }) {
  return (
    <div className="three">
      <NumSetting label="Win" value={value.win} min={-100} max={100} onSave={(win) => onSave({ win })} />
      <NumSetting label="Draw" value={value.draw} min={-100} max={100} onSave={(draw) => onSave({ draw })} />
      <NumSetting label="Loss" value={value.loss} min={-100} max={100} onSave={(loss) => onSave({ loss })} />
    </div>
  );
}

function RoundsEditor({ rounds, onSave }: { rounds: { id: string; name: string }[]; onSave: (r: { id: string; name: string }[]) => void }) {
  const text = rounds.map((r) => r.name).join(", ");
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  const save = () => {
    const names = v.split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length || names.join(", ") === text) return setV(text);
    // Keep each position's id so scores stay with their round when renamed.
    onSave(names.map((name, i) => ({ id: rounds[i]?.id ?? `r${Date.now().toString(36)}${i}`, name })));
  };
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

const TITLE_STYLES: { id: TitleStyle; name: string }[] = [
  { id: "bold", name: "Bold" },
  { id: "neon", name: "Neon" },
  { id: "chalk", name: "Chalkboard" },
  { id: "classic", name: "Classic" },
  { id: "marquee", name: "Marquee" },
];

function ThemeEditor({ view, run, staff, presets, onPresetSaved }: { view: BoardView; run: Runner["run"]; staff: boolean; presets: CustomPreset[]; onPresetSaved: () => void }) {
  const t = view.board.theme;
  const set = (theme: Partial<Theme> | Record<string, unknown>) => run({ type: "theme", theme });
  const [busy, setBusy] = useState("");
  const upload = async (file: File | undefined, apply: (name: string) => void) => {
    if (!file) return;
    setBusy("Uploading…");
    try {
      const r = await api.upload(file);
      apply(r.file);
      setBusy("");
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Upload failed.");
    }
  };
  return (
    <>
      <div className="chips presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={t.preset === p.id ? "on" : ""} onClick={() => set({ preset: p.id })}>
            {p.theme.emoji} {p.name}
          </button>
        ))}
        {presets.map((p) => (
          <button key={p.id} onClick={() => set({ ...p.theme, preset: "custom" })}>
            {p.theme.emoji} {p.name}
          </button>
        ))}
      </div>
      <Check label="Use the venue's colors (on a Bar Games box)" value={t.useVenue} onChange={(v) => set({ useVenue: v })} />
      <div className="three colors">
        <label>
          Accent
          <input type="color" value={t.accent} onChange={(e) => set({ accent: e.target.value, preset: "custom" })} />
        </label>
        <label>
          Second
          <input type="color" value={t.accent2} onChange={(e) => set({ accent2: e.target.value, preset: "custom" })} />
        </label>
        <label>
          Text
          <input type="color" value={t.text} onChange={(e) => set({ text: e.target.value, preset: "custom" })} />
        </label>
      </div>
      <label>
        Background
        <select value={t.background.kind} onChange={(e) => set({ background: { kind: e.target.value }, preset: "custom" })}>
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
          <option value="image">Image</option>
        </select>
      </label>
      <div className="three colors">
        <label>
          Color
          <input type="color" value={t.background.color} onChange={(e) => set({ background: { color: e.target.value }, preset: "custom" })} />
        </label>
        {t.background.kind === "gradient" && (
          <label>
            To
            <input type="color" value={t.background.color2} onChange={(e) => set({ background: { color2: e.target.value }, preset: "custom" })} />
          </label>
        )}
      </div>
      {t.background.kind === "image" && (
        <label>
          Background image (PNG, JPEG, WebP; up to 5 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => upload(e.target.files?.[0], (image) => set({ background: { kind: "image", image }, preset: "custom" }))} />
        </label>
      )}
      <div className="two">
        <label>
          Title style
          <select value={t.titleStyle} onChange={(e) => set({ titleStyle: e.target.value })}>
            {TITLE_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <TextSetting label="Emoji" value={t.emoji} max={8} onSave={(emoji) => set({ emoji })} />
      </div>
      <label>
        Sponsor or logo image (optional)
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => upload(e.target.files?.[0], (logo) => set({ logo }))} />
      </label>
      {t.logo && (
        <div className="logo-row">
          <img src={uploadUrl(t.logo)} alt="" />
          <button className="link" onClick={() => set({ logo: null })}>
            Remove logo
          </button>
        </div>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {staff && (
        <button
          className="link"
          onClick={async () => {
            const name = window.prompt("Name this look (it appears with the presets)", view.board.title);
            if (!name) return;
            const s = await api.settings();
            await api.saveSettings({ customPresets: [...s.customPresets, { id: "", name, theme: t }] });
            onPresetSaved();
          }}
        >
          Save this look as a preset
        </button>
      )}
    </>
  );
}

function SeasonEditor({ view, run, list }: { view: BoardView; run: Runner["run"]; list: BoardSummary[] }) {
  const b = view.board;
  const season = b.season ?? { boards: [], scoring: "placement" as const, placePoints: [10, 8, 6, 5, 4, 3, 2, 1] };
  const candidates = list.filter((x) => x.id !== b.id && x.format === "points" && x.kind !== "season").sort((x, y) => (x.startedAt ?? x.createdAt) - (y.startedAt ?? y.createdAt));
  const [pts, setPts] = useState(season.placePoints.join(", "));
  const save = (patch: Partial<typeof season>) => run({ type: "season", season: { ...season, ...patch } });
  return (
    <>
      <p className="muted small">A season board adds up nightly points boards: points per place, or each night's total. Teams are matched by name.</p>
      {candidates.length === 0 && <p className="muted">No other points boards yet.</p>}
      <div className="season-list">
        {candidates.map((c) => (
          <Check
            key={c.id}
            label={`${c.title} (${new Date(c.startedAt ?? c.createdAt).toLocaleDateString()})`}
            value={season.boards.includes(c.id)}
            onChange={(on) => save({ boards: on ? [...season.boards, c.id] : season.boards.filter((x) => x !== c.id) })}
          />
        ))}
      </div>
      <label>
        Each night counts
        <select value={season.scoring} onChange={(e) => save({ scoring: e.target.value as "placement" | "total" })}>
          <option value="placement">Points per place</option>
          <option value="total">The night's total score</option>
        </select>
      </label>
      {season.scoring === "placement" && (
        <label>
          Points for 1st, 2nd, 3rd…
          <input value={pts} onChange={(e) => setPts(e.target.value)} onBlur={() => save({ placePoints: pts.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite) })} />
        </label>
      )}
      {b.season && (
        <button className="link" onClick={() => run({ type: "season", season: null })}>
          Unlink all (back to a normal points table)
        </button>
      )}
    </>
  );
}

export function SetupPanel({ view, run, staff, list, toast }: { view: BoardView; run: Runner["run"]; staff: boolean; list: BoardSummary[]; toast: (t: string, e?: boolean) => void }) {
  const b = view.board;
  const nav = useNavigate();
  const [presets, setPresets] = useState<CustomPreset[]>([]);
  const loadPresets = () => {
    if (staff) void api.settings().then((s) => setPresets(s.customPresets), () => undefined);
  };
  useEffect(loadPresets, [staff]);
  const [pin, setPin] = useState("");
  const [lanes, setLanes] = useState(b.lanes.join(", "));
  useEffect(() => setLanes(b.lanes.join(", ")), [b.lanes.join(",")]);
  const [top, setTop] = useState(8);

  const copy = async (keepEntrants: boolean) => {
    const title = window.prompt("Name for the new board", b.title);
    if (!title) return;
    try {
      const v = await api.create({ title, format: b.format, copyFrom: b.id, keepEntrants });
      nav(`/host/${v.board.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", true);
    }
  };
  const knockout = async (format: FormatId) => {
    try {
      const v = await api.create({ title: `${b.title}: finals`, format, seedFrom: { boardId: b.id, top } });
      nav(`/host/${v.board.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", true);
    }
  };

  return (
    <div className="setup">
      <Section title="Name and format" open={b.status === "draft"}>
        <TextSetting label="Name" value={b.title} max={60} onSave={(title) => run({ type: "rename", title })} />
        <TextSetting label="Small print (optional)" value={b.subtitle} max={80} onSave={(subtitle) => run({ type: "rename", subtitle })} />
        {b.status === "draft" ? (
          <label>
            Format
            <select value={b.format} onChange={(e) => run({ type: "format", format: e.target.value as FormatId })}>
              {(Object.keys(FORMAT_NAMES) as FormatId[]).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_NAMES[f]}
                </option>
              ))}
            </select>
            <small className="muted">{FORMAT_HINTS[b.format]}</small>
          </label>
        ) : (
          <p className="muted small">{FORMAT_NAMES[b.format]} (fixed once started)</p>
        )}
        <FormatRules view={view} run={run} />
      </Section>

      {b.format !== "points" || b.settings.points.scoring === "matches" ? (
        <Section title="Lanes and tables">
          <p className="muted small">Name the lanes, boards or tables ("Board 1, Board 2"). Matches you put on a lane show as "up next" there, on the TV and to the players involved.</p>
          <input value={lanes} placeholder="Board 1, Board 2" onChange={(e) => setLanes(e.target.value)} onBlur={() => run({ type: "lanes", lanes: lanes.split(",").map((s) => s.trim()).filter(Boolean) })} />
        </Section>
      ) : null}

      <Section title="Look">
        <ThemeEditor view={view} run={run} staff={staff} presets={presets} onPresetSaved={() => (loadPresets(), toast("Saved as a preset."))} />
      </Section>

      {staff && (
        <Section title="Scorekeeper PIN">
          <p className="muted small">
            Someone who isn't staff (a trivia host, a league captain) can keep score on this board only: they open the scorekeeper page, pick this board and type the PIN.
            {b.hasPin ? " A PIN is set. Setting a new one, or removing it, signs out whoever used the old one." : " No PIN is set."}
          </p>
          <div className="two">
            <input inputMode="numeric" pattern="[0-9]*" maxLength={8} placeholder="4 to 8 digits" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            <button
              className="primary"
              disabled={pin.length < 4}
              onClick={async () => {
                try {
                  await api.setPin(b.id, pin);
                  setPin("");
                  toast(`PIN set to ${pin}. Tell your scorekeeper.`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : "That didn't work.", true);
                }
              }}
            >
              Set PIN
            </button>
          </div>
          {b.hasPin && (
            <button className="link" onClick={() => api.setPin(b.id, null).then(() => toast("PIN removed."), (err: Error) => toast(err.message, true))}>
              Remove the PIN
            </button>
          )}
        </Section>
      )}

      {b.format === "points" && (
        <Section title="Season (sum nightly boards)">
          <SeasonEditor view={view} run={run} list={list} />
        </Section>
      )}

      <Section title="Finish, export, next week" open={b.status !== "draft"}>
        {b.status === "live" && (
          <button className="primary wide" onClick={() => window.confirm(view.derived.complete ? "Finish this board and announce the winner?" : "Not every match is played. Finish anyway?") && run({ type: "finish" })}>
            Finish the board
          </button>
        )}
        {b.status === "finished" && (
          <button className="wide" onClick={() => run({ type: "reopen" })}>
            Reopen it
          </button>
        )}
        <a className="button wide" href={csvUrl(b.id)} download>
          Export as CSV
        </a>
        {staff && (
          <>
            <button className="wide" onClick={() => copy(true)}>
              Copy as a new board (same entrants)
            </button>
            <button className="wide" onClick={() => copy(false)}>
              Copy as a new board (empty)
            </button>
            {b.format !== "single" && b.format !== "double" && (
              <div className="knockout card">
                <p>
                  Knockout from these standings: the top{" "}
                  <input type="number" min={2} max={64} value={top} onChange={(e) => setTop(Number(e.target.value) || 2)} />
                  {b.format === "roundrobin" && b.settings.roundrobin.groups > 1 ? " (by group, A1 B1 A2…)" : ""}
                </p>
                <div className="two">
                  <button onClick={() => knockout("single")}>Single elimination</button>
                  <button onClick={() => knockout("double")}>Double elimination</button>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {staff && (
        <button
          className="danger wide"
          onClick={async () => {
            if (!window.confirm(`Delete "${b.title}" for good?`)) return;
            try {
              await api.remove(b.id);
              nav("/host");
            } catch (err) {
              toast(err instanceof Error ? err.message : "That didn't work.", true);
            }
          }}
        >
          Delete this board
        </button>
      )}
    </div>
  );
}
