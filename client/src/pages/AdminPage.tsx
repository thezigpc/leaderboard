// /admin (routes.admin): the app's settings, the board history (export, copy as next
// week's board, delete), saved looks. Staff only; on a box, staff signed in to the box get
// straight in, and "← Box admin" goes back.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BoxAdminLink } from "@bargames/gamekit/client";
import { FORMAT_NAMES, type AdminSettings, type AdminSettingsPatch, type NewBoards } from "@leaderboard/shared";
import { api, ApiError, csvUrl, setToken, type AuthStatus } from "../api";
import { useBoardList, useConfig } from "../live";
import { useVenue } from "../useVenue";
import { AuthForm, quietSignIn } from "../ui/AuthForm";

type Phase = { kind: "loading" } | { kind: "auth"; status: AuthStatus } | { kind: "ready" } | { kind: "offline"; message: string };

function Settings({ s, save }: { s: AdminSettings; save: (p: AdminSettingsPatch) => Promise<void> }) {
  const [name, setName] = useState(s.name);
  const cfg = useConfig();
  return (
    <section className="card">
      <h2>Settings</h2>
      {cfg?.onBox ? (
        <p className="muted small">On the box, the name comes from the box's Apps tab ("{cfg.gameName}").</p>
      ) : (
        <label>
          Name on the pages
          <input value={name} maxLength={60} placeholder="Leaderboard" onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.name && save({ name })} />
        </label>
      )}
      <label className="inline">
        Ask staff to look at a called match with no result after
        <select value={s.attentionMinutes} onChange={(e) => save({ attentionMinutes: Number(e.target.value) })}>
          {[0, 10, 15, 20, 30, 45, 60].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} min` : "never"}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">On a Bar Games box this shows on the box's Tonight page.</p>
      <p className="muted small">
        What the TVs show is set from the <Link to="/host">scorekeeper page</Link>.
      </p>
    </section>
  );
}

/** Who may start a board: staff, anyone with the host PIN (a trivia host who isn't staff), or anyone. */
function NewBoardsCard({ s, save }: { s: AdminSettings; save: (p: AdminSettingsPatch) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const choices: { id: NewBoards; title: string; sub: string }[] = [
    { id: "staff", title: "Staff only", sub: "Staff start boards from the scorekeeper page." },
    { id: "pin", title: "Anyone with the host PIN", sub: "The players' page shows \"Start a board\"; it asks for the PIN." },
    { id: "open", title: "Anyone", sub: "No PIN. Anyone who can open the players' page can start a board." },
  ];
  return (
    <section className="card">
      <h2>Who can start a board</h2>
      <p className="muted small">
        For events run by someone who isn't staff. A host who starts a board keeps score on that board only, and gets a PIN for it to score from a second phone.
      </p>
      <div className="pick-list" role="radiogroup" aria-label="Who can start a board">
        {choices.map((c) => (
          <button key={c.id} role="radio" aria-checked={s.newBoards === c.id} className={`pick-row ${s.newBoards === c.id ? "on" : ""}`} onClick={() => save({ newBoards: c.id })}>
            <span className="box" aria-hidden="true">
              {s.newBoards === c.id ? "✓" : ""}
            </span>
            <span className="what">
              <b>{c.title}</b>
              <small>{c.sub}</small>
            </span>
          </button>
        ))}
      </div>
      {s.newBoards === "pin" && (
        <>
          {!s.hostPinSet && <p className="notice warn">Set a host PIN to turn this on. Until then only staff can start boards.</p>}
          <form
            className="two"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ hostPin: pin }).then(() => setPin(""));
            }}
          >
            <label>
              {s.hostPinSet ? "New host PIN" : "Host PIN"}
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="4 to 8 digits"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/D/g, ""))}
              />
            </label>
            <button className="primary" disabled={pin.length < 4}>
              {s.hostPinSet ? "Change PIN" : "Set PIN"}
            </button>
          </form>
          {s.hostPinSet && (
            <p className="muted small">
              A host PIN is set. Changing it signs hosts out of starting more boards; boards they already started stay theirs.{" "}
              <button className="link" onClick={() => save({ hostPin: null })}>
                Remove the PIN
              </button>
            </p>
          )}
        </>
      )}
      {s.newBoards === "open" && <p className="notice warn">If this app can be reached from the internet, anyone there can start boards too (a few an hour each).</p>}
    </section>
  );
}

export function AdminPage() {
  const venue = useVenue();
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const list = useBoardList() ?? [];

  const check = useCallback(async () => {
    try {
      const q = await quietSignIn();
      if (!q.ok) return setPhase({ kind: "auth", status: q.status });
      setSettings(await api.settings());
      setPhase({ kind: "ready" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken("");
        return void check();
      }
      setPhase({ kind: "offline", message: err instanceof Error ? err.message : "Can't reach the server." });
    }
  }, []);
  useEffect(() => {
    document.title = "Leaderboard admin";
    void check();
  }, [check]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const save = async (patch: AdminSettingsPatch) => {
    try {
      const r = await api.saveSettings(patch);
      setSettings(r.settings);
      setNotice({ text: "Saved.", error: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return void check();
      setNotice({ text: err instanceof Error ? err.message : "That didn't work.", error: true });
    }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setNotice({ text: ok, error: false });
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "That didn't work.", error: true });
    }
  };

  return (
    <div className="admin">
      <BoxAdminLink ctx={venue} />
      <header className="host-top">
        <h1>Leaderboard admin</h1>
        {phase.kind === "ready" && (
          <button
            className="link"
            onClick={async () => {
              await api.logout().catch(() => undefined);
              setToken("");
              void check();
            }}
          >
            Sign out
          </button>
        )}
      </header>
      {phase.kind === "loading" && <p className="muted">Loading…</p>}
      {phase.kind === "offline" && <p className="error">{phase.message}</p>}
      {phase.kind === "auth" && <AuthForm status={phase.status} title="Sign in" onDone={check} />}
      {phase.kind === "ready" && settings && (
        <>
          <p>
            <Link to="/host" className="button primary">
              Keep score →
            </Link>{" "}
            <Link to="/tv" className="button">
              TV view
            </Link>{" "}
            <Link to="/" className="button">
              Players' page
            </Link>
          </p>
          <Settings s={settings} save={save} />
          <NewBoardsCard s={settings} save={save} />

          <section className="card">
            <h2>Boards</h2>
            {list.length === 0 && <p className="muted">No boards yet.</p>}
            <table className="history">
              <thead>
                <tr>
                  <th>Board</th>
                  <th>Status</th>
                  <th>Winner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/host/${b.id}`}>
                        {b.theme.emoji} {b.title}
                      </Link>
                      <small>
                        {FORMAT_NAMES[b.format]} · {new Date(b.startedAt ?? b.createdAt).toLocaleDateString()}
                      </small>
                    </td>
                    <td>
                      <span className={`status ${b.status}`}>{b.status}</span>
                    </td>
                    <td>{b.winners?.join(" & ") ?? ""}</td>
                    <td className="actions">
                      <a href={csvUrl(b.id)} download>
                        CSV
                      </a>
                      <button
                        className="link"
                        onClick={async () => {
                          const title = window.prompt("Name for the copy", b.title);
                          if (!title) return;
                          try {
                            const v = await api.create({ title, format: b.format, copyFrom: b.id, keepEntrants: window.confirm("Keep the same entrants?") });
                            nav(`/host/${v.board.id}`);
                          } catch (err) {
                            setNotice({ text: err instanceof Error ? err.message : "That didn't work.", error: true });
                          }
                        }}
                      >
                        Copy
                      </button>
                      <button className="link danger" onClick={() => window.confirm(`Delete "${b.title}" for good?`) && act(() => api.remove(b.id), "Deleted.")}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Saved looks</h2>
            <p className="muted small">Save a board's look from its Setup tab; it then appears with the presets on every board.</p>
            {settings.customPresets.length === 0 && <p className="muted">None yet.</p>}
            <ul className="presets-list">
              {settings.customPresets.map((p) => (
                <li key={p.id}>
                  <span className="swatch" style={{ background: `linear-gradient(135deg, ${p.theme.background.color}, ${p.theme.accent})` }} />
                  {p.theme.emoji} {p.name}
                  <button className="link danger" onClick={() => save({ customPresets: settings.customPresets.filter((x) => x.id !== p.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {notice && <div className={`toast ${notice.error ? "error" : ""}`}>{notice.text}</div>}
    </div>
  );
}
