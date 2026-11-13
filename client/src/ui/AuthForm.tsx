// Staff sign-in, shared by /host and /admin. On a box the box's admin password signs in (and
// staff who came from the box are signed in without it); standalone, the first visit sets
// the app's admin password.

import { useState, type FormEvent } from "react";
import { staffSignIn } from "@bargames/gamekit/client";
import { basePath } from "@bargames/sdk/client";
import { api, ApiError, getToken, setToken, type AuthStatus } from "../api";

/** Signs in without a password when we can: a saved session, or the box vouching for staff. */
export async function quietSignIn(): Promise<{ ok: boolean; status: AuthStatus }> {
  const status = await api.status();
  if (status.authenticated && getToken()) return { ok: true, status };
  const staff = await staffSignIn(basePath());
  if (staff) {
    setToken(staff);
    return { ok: true, status };
  }
  if (getToken()) setToken("");
  return { ok: false, status };
}

export function AuthForm({ status, onDone, title }: { status: AuthStatus; onDone: () => void; title: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wantSetup, setWantSetup] = useState(false);
  const setup = status.venueLogin ? wantSetup && status.setupAllowed : status.setupNeeded;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      const r = setup ? await api.setup(password) : await api.login(password);
      setToken(r.token);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && status.venueLogin) setError("That isn't the venue box's admin password.");
      else setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (status.broken && !status.venueLogin)
    return (
      <div className="card">
        <h2>{title}</h2>
        <p className="error">The admin password file on the server is damaged. Ask whoever runs the server to fix or delete admin.json in the data folder.</p>
      </div>
    );
  return (
    <form className="card auth" onSubmit={submit}>
      <h2>{title}</h2>
      <p className="muted">
        {setup
          ? status.venueLogin
            ? `Choose a separate password for the leaderboard (the box's admin password keeps working too). At least ${status.minPasswordLength} characters.`
            : `Choose the staff password. Whoever sets it first becomes the admin, so do this now. At least ${status.minPasswordLength} characters.`
          : status.venueLogin
            ? `Sign in with the venue box's admin password${status.configured ? " (or the leaderboard's own)" : ""}.`
            : "Staff sign in."}
      </p>
      <label>
        Password
        <input type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {setup && (
        <label>
          Password again
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !password}>
        {setup ? "Set password" : "Sign in"}
      </button>
      {status.venueLogin && status.setupAllowed && (
        <button type="button" className="link" onClick={() => setWantSetup((v) => !v)}>
          {wantSetup ? "Sign in with the box's password instead" : "Set a separate password"}
        </button>
      )}
    </form>
  );
}
