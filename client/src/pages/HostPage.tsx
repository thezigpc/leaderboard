// The scorekeeper's phone UI (routes.host "/host"): staff see every board and can make new
// ones; someone with a board's PIN sees that board. One-handed: big targets, few keystrokes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FORMAT_NAMES, type BoardSummary, type BoardView, type WhoAmI } from "@leaderboard/shared";
import { api, ApiError, scorerTokens, setScorerToken, setToken, type AuthStatus } from "../api";
import { useBoard, useBoardList, useConfig, useTvSettings } from "../live";
import { AuthForm, quietSignIn } from "../ui/AuthForm";
import { since } from "../ui/format";
import { BoardTitle, Themed } from "../ui/Theme";
import { BracketSetup } from "../host/BracketSetup";
import { EntrantsPanel } from "../host/EntrantsPanel";
import { useWide } from "../host/kit";
import { NewBoardWizard } from "../host/NewBoardWizard";
import { ScorePanel } from "../host/ScorePanel";
import { SetupPanel } from "../host/SetupPanel";
import { useActions } from "../host/useActions";

type Toast = { text: string; error: boolean } | null;
type Tab = "score" | "entrants" | "bracket" | "setup";

function useToast(): [Toast, (text: string, error?: boolean) => void] {
  const [t, setT] = useState<Toast>(null);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.error ? 6000 : 2500);
    return () => clearTimeout(h);
  }, [t]);
  return [t, useCallback((text: string, error = false) => setT({ text, error }), [])];
}

function ToastView({ t }: { t: Toast }) {
  return t ? <div className={`toast ${t.error ? "error" : ""}`}>{t.text}</div> : null;
}

/** Who this browser is: staff, or scorekeeper of some boards. */
function useWho() {
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const q = await quietSignIn();
      setStatus(q.status);
      const me = await api.me();
      // Forget PIN tokens the server no longer accepts.
      for (const id of Object.keys(scorerTokens())) if (!me.boards.includes(id) && !me.staff) setScorerToken(id, null);
      setWho(me);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Can't reach the server.");
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  return { who, status, error, refresh };
}

function PinSignIn({ boards, onDone }: { boards: BoardSummary[]; onDone: (id: string) => void }) {
  const withPin = boards.filter((b) => b.hasPin && b.status !== "finished");
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!withPin.length) return null;
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          const r = await api.pinLogin(id, pin);
          setScorerToken(id, r.token);
          onDone(id);
        } catch (error) {
          setErr(error instanceof Error ? error.message : "That didn't work.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Keep score with a PIN</h2>
      <p className="muted">Staff gave you a PIN for one board.</p>
      <label>
        Board
        <select value={id} onChange={(e) => setId(e.target.value)} required>
          <option value="">Pick…</option>
          {withPin.map((b) => (
            <option key={b.id} value={b.id}>
              {b.theme.emoji} {b.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        PIN
        <input inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
      </label>
      {err && <p className="error">{err}</p>}
      <button className="primary wide" disabled={busy || !id || pin.length < 4}>
        Start scoring
      </button>
    </form>
  );
}

function BoardRow({ b }: { b: BoardSummary }) {
  return (
    <Link to={`/host/${b.id}`} className="host-row">
      <span className="emoji">{b.theme.emoji}</span>
      <span className="main">
        <b>{b.title}</b>
        <small>
          {FORMAT_NAMES[b.format]} · {b.participants} · {b.status === "finished" ? `won by ${b.winners?.join(" & ") || "–"}` : b.leader ? `${b.leader} leads` : since(b.updatedAt)}
        </small>
      </span>
      <span className={`status ${b.status}`}>{b.status}</span>
    </Link>
  );
}

function HostHome({ who, status, refresh }: { who: WhoAmI; status: AuthStatus; refresh: () => void }) {
  const list = useBoardList() ?? [];
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const cfg = useConfig();
  const mine = who.staff ? list : list.filter((b) => who.boards.includes(b.id));
  const active = mine.filter((b) => b.status !== "finished");
  const done = mine.filter((b) => b.status === "finished").slice(0, 10);
  return (
    <div className="host">
      <header className="host-top">
        <h1>{cfg?.gameName ?? "Leaderboard"}: scorekeeper</h1>
        {who.staff && (
          <button
            className="link"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setToken("");
              refresh();
            }}
          >
            Sign out
          </button>
        )}
      </header>
      {who.staff ? (
        <>
          {creating ? <NewBoardWizard onCreated={(id) => nav(`/host/${id}`)} onCancel={() => setCreating(false)} /> : (
            <button className="primary wide big" onClick={() => setCreating(true)}>
              + New board
            </button>
          )}
          <TvControl list={list} staff />
        </>
      ) : (
        <>
          {who.boards.length === 0 && <p className="muted">Sign in as staff, or use a board's PIN.</p>}
          <PinSignIn boards={list} onDone={(id) => (refresh(), nav(`/host/${id}`))} />
          {showSignIn ? (
            <AuthForm status={status} title="Staff sign-in" onDone={refresh} />
          ) : (
            <button className="link" onClick={() => setShowSignIn(true)}>
              Staff sign-in
            </button>
          )}
        </>
      )}
      {active.length > 0 && <h2>Boards</h2>}
      {active.map((b) => (
        <BoardRow key={b.id} b={b} />
      ))}
      {done.length > 0 && <h2>Finished</h2>}
      {done.map((b) => (
        <BoardRow key={b.id} b={b} />
      ))}
      {who.staff && (
        <p className="muted small">
          History, presets and app settings are on the <Link to="/admin">admin page</Link>.
        </p>
      )}
    </div>
  );
}

/** What the TVs show. Staff: any choice. A scorekeeper: just "show my board". */
function TvControl({ list, staff, boardId }: { list: BoardSummary[]; staff: boolean; boardId?: string }) {
  const tv = useTvSettings();
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  if (!tv) return null;
  const names = new Map(list.map((b) => [b.id, b.title]));
  const now =
    tv.mode === "board" && tv.boardId
      ? names.get(tv.boardId) ?? "a deleted board"
      : tv.mode === "rotate"
        ? `${tv.boardIds.length} chosen boards, ${tv.rotateSeconds} s each`
        : `every live board, ${tv.rotateSeconds} s each`;
  const set = async (patch: Parameters<typeof api.setTv>[0]) => {
    try {
      await api.setTv(patch);
      setErr("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That didn't work.");
    }
  };
  const live = list.filter((b) => b.status !== "draft");
  return (
    <div className="card tv-control">
      <button className="tv-now" onClick={() => setOpen((v) => !v)}>
        📺 TVs show: <b>{now}</b>
      </button>
      {boardId && !(tv.mode === "board" && tv.boardId === boardId) && (
        <button className="primary wide" onClick={() => set({ mode: "board", boardId })}>
          Show this board on the TVs
        </button>
      )}
      {open && staff && (
        <>
          <button className={`wide ${tv.mode === "auto" ? "on" : ""}`} onClick={() => set({ mode: "auto" })}>
            Rotate every live board
          </button>
          <p className="muted small">Or choose boards to rotate:</p>
          <div className="season-list">
            {live.map((b) => (
              <label className="check" key={b.id}>
                <input
                  type="checkbox"
                  checked={tv.mode === "rotate" ? tv.boardIds.includes(b.id) : tv.mode === "board" && tv.boardId === b.id}
                  onChange={(e) => {
                    const cur = tv.mode === "rotate" ? tv.boardIds : tv.mode === "board" && tv.boardId ? [tv.boardId] : [];
                    const ids = e.target.checked ? [...cur, b.id] : cur.filter((x) => x !== b.id);
                    void set(ids.length === 1 ? { mode: "board", boardId: ids[0] } : ids.length ? { mode: "rotate", boardIds: ids } : { mode: "auto" });
                  }}
                />{" "}
                {b.theme.emoji} {b.title}
              </label>
            ))}
          </div>
          <label className="inline">
            Seconds per board
            <select value={tv.rotateSeconds} onChange={(e) => set({ rotateSeconds: Number(e.target.value) })}>
              {[10, 15, 20, 30, 45, 60, 90].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={tv.showQr} onChange={(e) => set({ showQr: e.target.checked })} /> Show the "follow along" QR code
          </label>
          <p className="muted small">A TV opened at /tv?board=… always shows that one board.</p>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function Countdown({ toast }: { toast: (t: string, e?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState(10);
  if (!open)
    return (
      <button className="link" onClick={() => setOpen(true)}>
        ⏱ Countdown on the venue's screens…
      </button>
    );
  return (
    <div className="card">
      <label>
        What's starting
        <input value={label} maxLength={60} placeholder="Cornhole starts in" onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="inline">
        Minutes
        <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </label>
      <div className="two">
        <button
          className="primary"
          disabled={!label.trim()}
          onClick={() =>
            api.countdown(label, minutes).then(
              () => (toast("Countdown started."), setOpen(false)),
              (e: Error) => toast(e.message, true),
            )
          }
        >
          Start
        </button>
        <button onClick={() => api.clearCountdown().then(() => toast("Countdown cleared."), (e: Error) => toast(e.message, true))}>Clear</button>
      </div>
    </div>
  );
}

function HostBoard({ id, who, onAuthLost }: { id: string; who: WhoAmI; onAuthLost: () => void }) {
  const s = useBoard(id);
  const list = useBoardList() ?? [];
  const cfg = useConfig();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab | null>(null);
  const wide = useWide();
  const [canUndo, setCanUndo] = useState(false);
  const view = s.status === "ready" ? s.view : null;
  const setView = useCallback(
    (v: BoardView) => {
      s.set?.(v);
      setCanUndo(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.set],
  );
  const { run, undo } = useActions(view, setView, showToast, onAuthLost);
  const allowed = who.staff || who.boards.includes(id);
  useEffect(() => {
    if (view) document.title = `Score: ${view.board.title}`;
  }, [view?.board.title]);
  // Ask once whether there's anything to undo (from earlier on this server).
  useEffect(() => {
    void api.board(id).then((r) => setCanUndo(!!r.canUndo), () => undefined);
  }, [id]);
  // Before the start: Entrants first; once it's running: Score. Switches when it starts.
  const status = view?.board.status;
  useEffect(() => {
    if (status) setTab(status === "draft" ? "entrants" : "score");
  }, [status]);

  if (s.status === "loading") return <p className="muted center pad">Loading…</p>;
  if (!view)
    return (
      <div className="host">
        <p className="empty">That board is gone.</p>
        <Link to="/host">← Boards</Link>
      </div>
    );
  if (!allowed)
    return (
      <div className="host">
        <Link to="/host">← Boards</Link>
        <p className="empty">You need staff sign-in or this board's PIN to keep score here.</p>
      </div>
    );
  const b = view.board;
  const draft = b.status === "draft";
  const tabs: Tab[] = draft ? ["entrants", ...(b.format === "single" || b.format === "double" ? (["bracket"] as Tab[]) : []), "setup"] : ["score", "entrants", "setup"];
  const shown: Tab = tab && tabs.includes(tab) ? tab : tabs[0];
  return (
    <Themed theme={b.theme} className={`host host-board ${wide && (shown === "entrants" || shown === "bracket") ? "wide" : ""}`}>
      <header className="hb-top">
        <Link to="/host" className="back">
          ←
        </Link>
        <BoardTitle theme={b.theme} title={b.title} />
        <button
          className="undo"
          disabled={!canUndo}
          onClick={async () => {
            if (await undo()) showToast("Undone.");
            else setCanUndo(false);
          }}
        >
          ↶ Undo
        </button>
      </header>
      <p className="hb-status">
        <span className={`status ${b.status}`}>{b.status}</span>
        {b.status === "finished" && b.winners?.length ? <> 🏆 {b.winners.join(" & ")}</> : null}
      </p>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t} className={shown === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "score" ? "Score" : t === "bracket" ? "Bracket" : t === "entrants" ? `${b.entry?.kind === "teams" ? "Teams" : "Entrants"} (${b.participants.filter((p) => !p.withdrawn).length})` : "Setup"}
          </button>
        ))}
      </nav>
      {shown === "score" && <ScorePanel view={view} run={run} />}
      {shown === "entrants" && <EntrantsPanel view={view} run={run} wide={wide} onNext={() => setTab("bracket")} />}
      {shown === "bracket" && <BracketSetup view={view} run={run} wide={wide} onStarted={() => setTab("score")} />}
      {shown === "setup" && <SetupPanel view={view} run={run} staff={who.staff} list={list} toast={showToast} />}
      <div className="hb-extras">
        <TvControl list={list} staff={who.staff} boardId={b.status !== "draft" ? b.id : undefined} />
        {cfg?.onBox && <Countdown toast={showToast} />}
        <Link to={`/b/${b.id}`} className="link small">
          Open the players' view
        </Link>
      </div>
      <ToastView t={toast} />
    </Themed>
  );
}

export function HostPage() {
  const { id } = useParams();
  const { who, status, error, refresh } = useWho();
  const list = useBoardList();
  useEffect(() => {
    document.title = "Scorekeeper";
  }, []);
  const content = useMemo(() => {
    if (error) return <p className="error pad">{error}</p>;
    if (!who || !status) return <p className="muted center pad">Loading…</p>;
    if (id) return <HostBoard id={id} who={who} onAuthLost={refresh} />;
    if (!who.staff && who.boards.length === 0 && !(list ?? []).some((b) => b.hasPin))
      return (
        <div className="host">
          <AuthForm status={status} title="Scorekeeper sign-in" onDone={refresh} />
        </div>
      );
    return <HostHome who={who} status={status} refresh={refresh} />;
  }, [error, who, status, id, list, refresh]);
  return content;
}
