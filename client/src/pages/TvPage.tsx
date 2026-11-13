// The TV view (routes.table "/tv"): nobody touches it. It shows one board, or rotates through
// the live boards (the host picks on their phone; /tv?board=<id> pins one TV to one board).
// Standings page through when they don't fit; brackets fit or zoom to the live part. It
// survives network blips (socket.io reconnects; HTTP polling meanwhile) and reloads itself
// when the server is updated.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { VenueAnnouncement } from "@bargames/gamekit/client";
import { isOnBox, joinUrl, tableMode, type TableModeController } from "@bargames/sdk/client";
import { bgUrl } from "@bargames/sdk/client";
import { groupName, leaders, type BoardSummary, type BoardView, type StandingRow } from "@leaderboard/shared";
import { getSocket, useBoardList, useBoards, useConfig, useTvSettings } from "../live";
import { useVenue } from "../useVenue";
import { uploadUrl } from "../api";
import { BracketTv } from "../ui/Bracket";
import { isBracket, namesOf, valueText } from "../ui/format";
import { MatchLine } from "../ui/Matches";
import { Qr } from "../ui/Qr";
import { StandingsTable } from "../ui/Standings";
import { BoardTitle, Themed } from "../ui/Theme";

const TABLE_PAGE_MS = 9000;

/** Which boards this TV shows, in order. */
function useShownBoards(list: BoardSummary[] | null): string[] {
  const [params] = useSearchParams();
  const tv = useTvSettings();
  const pinned = params.get("board");
  if (pinned) return [pinned];
  if (!list || !tv) return [];
  const exists = new Set(list.map((b) => b.id));
  if (tv.mode === "board" && tv.boardId && exists.has(tv.boardId)) return [tv.boardId];
  if (tv.mode === "rotate") {
    const chosen = tv.boardIds.filter((id) => exists.has(id));
    if (chosen.length) return chosen;
  }
  return list
    .filter((b) => b.status === "live")
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .map((b) => b.id);
}

/** Splits rows into pages that fit the box, cycling every few seconds. */
function PagedTable({ view, rows, title }: { view: BoardView; rows: StandingRow[]; title?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [per, setPer] = useState(10);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const rowH = (window.innerHeight * 6.4) / 100;
      setPer(Math.max(3, Math.floor((el.clientHeight - rowH * 1.2) / rowH)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    if (pages < 2) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), TABLE_PAGE_MS);
    return () => clearInterval(t);
  }, [pages]);
  const p = Math.min(page, pages - 1);
  return (
    <div className="tv-table" ref={box}>
      {title && <h3>{title}</h3>}
      <StandingsTable view={view} rows={rows.slice(p * per, p * per + per)} />
      {pages > 1 && (
        <div className="page-dots">
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} className={i === p ? "on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidePanel({ view, qr }: { view: BoardView; qr: string | null }) {
  const names = useMemo(() => namesOf(view.board), [view.board]);
  const d = view.derived;
  const next = d.upNext.slice(0, 4);
  const results = d.matches
    .filter((m) => m.state === "done")
    .sort((a, b) => (b.result?.at ?? 0) - (a.result?.at ?? 0))
    .slice(0, next.length ? 2 : 4);
  const hasMatches = next.length > 0 || results.length > 0;
  const best = view.board.format === "best";
  const attempts = best ? [...view.board.attempts].sort((a, b) => b.at - a.at).slice(0, 5) : [];
  return (
    <aside className="tv-side">
      <div className="tv-side-lists">
      {next.length > 0 && (
        <section>
          <h3>Up next</h3>
          {next.map((m) => (
            <MatchLine key={m.id} m={m} names={names} all={d.matches} />
          ))}
        </section>
      )}
      {results.length > 0 && (
        <section>
          <h3>Latest</h3>
          {results.map((m) => (
            <MatchLine key={m.id} m={m} names={names} all={d.matches} />
          ))}
        </section>
      )}
      {attempts.length > 0 && (
        <section>
          <h3>Latest</h3>
          {attempts.map((a) => (
            <div key={a.id} className="match-line done">
              <span className="ml-body">
                <span>{names.get(a.pid)}</span>
                <b className="attempt-value">{valueText(view, a.value)}</b>
              </span>
            </div>
          ))}
        </section>
      )}
      {!hasMatches && view.board.status === "live" && !best && view.board.format !== "points" && <p className="muted">Waiting for the first match.</p>}
      </div>
      {qr && (
        <section className="tv-qr">
          <Qr text={qr} size={170} />
          <p>
            Follow along
            <small>{qr.replace(/^https?:\/\//, "")}</small>
          </p>
        </section>
      )}
    </aside>
  );
}

/** "New leader" for a few seconds when the top spot changes. */
function useLeaderFlash(view: BoardView): string | null {
  const names = namesOf(view.board);
  const top = leaders(view.derived);
  const key = top.length === 1 ? top[0] : "";
  const prev = useRef<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = key;
    if (was === null || !key || was === key || view.board.status !== "live") return;
    setShown(names.get(key) ?? null);
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shown;
}

function TvBoard({ view, qr }: { view: BoardView; qr: string | null }) {
  const b = view.board;
  const d = view.derived;
  const leader = useLeaderFlash(view);
  const bracket = isBracket(b);
  let main: JSX.Element;
  if (bracket) main = <BracketTv view={view} />;
  else if (d.groupStandings && d.groupStandings.length > 1)
    main = (
      <div className="tv-groups">
        {d.groupStandings.slice(0, 4).map((rows, i) => (
          <PagedTable key={i} view={view} rows={rows} title={`Group ${groupName(i)}`} />
        ))}
      </div>
    );
  else main = <PagedTable view={view} rows={d.standings} />;
  return (
    <Themed theme={b.theme} className="tv-board">
      <header className="tv-head">
        <BoardTitle theme={b.theme} title={b.title} subtitle={b.subtitle} big />
        {b.status === "finished" && b.winners?.length ? <div className="tv-winner">🏆 {b.winners.join(" & ")}</div> : null}
        {b.theme.logo && <img className="tv-logo" src={uploadUrl(b.theme.logo)} alt="" />}
      </header>
      <div className="tv-body">
        <main className="tv-main">{main}</main>
        <SidePanel view={view} qr={qr} />
      </div>
      {leader && (
        <div className="tv-toast" key={leader}>
          New leader: <b>{leader}</b>
        </div>
      )}
    </Themed>
  );
}

function Idle({ name, list }: { name: string; list: BoardSummary[] }) {
  const done = list.filter((b) => b.status === "finished" && b.finishedAt && Date.now() - b.finishedAt < 12 * 3600_000).slice(0, 6);
  return (
    <div className="tv-idle">
      <h1>{name}</h1>
      {done.length ? (
        <>
          <h2>Tonight's winners</h2>
          <ul>
            {done.map((b) => (
              <li key={b.id}>
                <span>
                  {b.theme.emoji} {b.title}
                </span>
                <b>{b.winners?.join(" & ") || "–"}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No events running right now.</p>
      )}
    </div>
  );
}

export function TvPage() {
  const venue = useVenue();
  const cfg = useConfig();
  const list = useBoardList();
  const ids = useShownBoards(list);
  const boards = useBoards(ids);
  const tm = useRef<TableModeController | null>(null);

  // On a box: hide the pointer, keep the screen awake, mark the page as a shared screen, and
  // show "Reconnecting…" while the socket is down.
  useEffect(() => {
    if (!venue || tm.current) return;
    tm.current = tableMode(venue);
  }, [venue]);
  useEffect(() => {
    const s = getSocket();
    const down = () => tm.current?.setState("reconnecting");
    const up = () => tm.current?.setState("connected");
    s.on("disconnect", down);
    s.on("connect", up);
    return () => {
      s.off("disconnect", down);
      s.off("connect", up);
    };
  }, []);
  useEffect(() => {
    document.title = `${cfg?.gameName ?? "Leaderboard"} TV`;
  }, [cfg]);

  // A TV left on for days picks up a new version of the app by itself.
  useEffect(() => {
    if (!cfg?.build || cfg.build === "dev") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(bgUrl("/api/config"), { cache: "no-store" });
        const now = (await r.json()) as { build?: string };
        if (now.build && now.build !== cfg.build) location.reload();
      } catch {
        /* offline: try later */
      }
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [cfg?.build]);

  // Rotation, jumping to a board the moment it gets a new result.
  const tv = useTvSettings();
  const seconds = tv?.rotateSeconds ?? 20;
  const [idx, setIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const lastSeen = useRef(new Map<string, number>());
  const key = ids.join(",");
  useEffect(() => {
    if (ids.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % ids.length), seconds * 1000);
    return () => clearInterval(t);
  }, [key, seconds, tick]);
  useEffect(() => {
    ids.forEach((id, i) => {
      const s = boards.get(id);
      if (s?.status !== "ready") return;
      const at = s.view.board.lastChange?.at ?? 0;
      const seen = lastSeen.current.get(id);
      lastSeen.current.set(id, at);
      if (seen !== undefined && at > seen && ids.length > 1) {
        setIdx(i);
        setTick((x) => x + 1);
      }
    });
  }, [boards, key]);

  const shown = ids.length ? boards.get(ids[idx % ids.length]) : undefined;
  const view = shown?.status === "ready" ? shown.view : null;
  const qrOn = tv?.showQr ?? true;
  const qr = view && qrOn ? joinUrl(isOnBox(venue) ? venue : null, `/b/${view.board.id}`) : null;
  return (
    <div className="tv">
      <VenueAnnouncement ctx={venue} />
      <div className="tv-frame">
        {view ? <TvBoard key={view.board.id} view={view} qr={qr} /> : list ? <Idle name={cfg?.gameName ?? "Leaderboard"} list={list} /> : null}
      </div>
      {ids.length > 1 && (
        <div className="tv-rotation">
          {ids.map((id, i) => (
            <span key={id} className={i === idx % ids.length ? "on" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}
