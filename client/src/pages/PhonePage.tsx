// The public phone page (routes.player "/"): the live boards, then one board with its
// standings, bracket and matches. A player can "follow" their name to see where they stand
// and when they're up next. Read-only.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackToGames } from "@bargames/gamekit/client";
import { FORMAT_NAMES, type BoardSummary, type BoardView, type DerivedMatch } from "@leaderboard/shared";
import { useBoard, useBoardList, useConfig } from "../live";
import { useVenue } from "../useVenue";
import { BracketScroll } from "../ui/Bracket";
import { isBracket, namesOf, ordinal, since, slotName, valueText } from "../ui/format";
import { MatchLine } from "../ui/Matches";
import { GroupTables, StandingsTable } from "../ui/Standings";
import { BoardTitle, Themed, themeVars } from "../ui/Theme";

const followKey = (id: string) => `leaderboard_follow_${id}`;
function useFollow(boardId: string): [string, (id: string) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(followKey(boardId)) ?? "";
    } catch {
      return "";
    }
  });
  const set = (id: string) => {
    setV(id);
    try {
      if (id) localStorage.setItem(followKey(boardId), id);
      else localStorage.removeItem(followKey(boardId));
    } catch {
      /* fine: just for this visit */
    }
  };
  return [v, set];
}

function BoardCard({ b }: { b: BoardSummary }) {
  return (
    <Link to={`/b/${b.id}`} className="board-card" style={themeVars(b.theme)}>
      <span className="bc-emoji">{b.theme.emoji}</span>
      <span className="bc-main">
        <span className="bc-title">{b.title}</span>
        <span className="bc-sub">
          {FORMAT_NAMES[b.format]} · {b.participants} {b.participants === 1 ? "entrant" : "entrants"}
        </span>
      </span>
      {b.leader && (
        <span className="bc-leader">
          <small>{b.status === "finished" ? "Winner" : "Leading"}</small>
          {b.leader}
        </span>
      )}
    </Link>
  );
}

export function PhoneHome() {
  const list = useBoardList();
  const venue = useVenue();
  const cfg = useConfig();
  useEffect(() => {
    if (cfg) document.title = cfg.gameName;
  }, [cfg]);
  const live = (list ?? []).filter((b) => b.status === "live");
  const recent = (list ?? []).filter((b) => b.status === "finished" && b.finishedAt && Date.now() - b.finishedAt < 36 * 3600_000);
  return (
    <div className="phone">
      <header className="ph-head">
        <h1>{cfg?.gameName ?? "Leaderboard"}</h1>
        <p className="muted">Live standings and brackets</p>
      </header>
      {list === null ? (
        <p className="muted center">Loading…</p>
      ) : (
        <>
          {live.length === 0 && <p className="empty">Nothing running right now. Check back when the next event starts.</p>}
          <div className="board-cards">
            {live.map((b) => (
              <BoardCard key={b.id} b={b} />
            ))}
          </div>
          {recent.length > 0 && (
            <>
              <h2 className="ph-section">Finished</h2>
              <div className="board-cards">
                {recent.map((b) => (
                  <BoardCard key={b.id} b={b} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <footer className="ph-foot">
        <BackToGames ctx={venue} />
      </footer>
    </div>
  );
}

/** What the followed player should know: up next, waiting on, place. */
function FollowCard({ view, me }: { view: BoardView; me: string }) {
  const names = namesOf(view.board);
  const d = view.derived;
  const mine = (m: DerivedMatch) => (m.a.kind === "player" && m.a.id === me) || (m.b.kind === "player" && m.b.id === me);
  const opp = (m: DerivedMatch) => slotName(m.a.kind === "player" && m.a.id === me ? m.b : m.a, names, d.matches);
  const next = d.upNext.find(mine);
  const waiting = d.matches.find((m) => m.state === "waiting" && mine(m));
  const row = d.standings.find((r) => r.id === me);
  const champ = d.champion === me;
  return (
    <div className="follow-card">
      {champ && view.board.status !== "draft" && d.complete ? (
        <p className="big">🏆 You won!</p>
      ) : next ? (
        <p className="big">
          You're up{next.lane ? ` on ${next.lane}` : ""}: vs <b>{opp(next)}</b>
          <small>{next.label}</small>
        </p>
      ) : waiting ? (
        <p>
          Next: <b>{waiting.label}</b> vs {opp(waiting)}
        </p>
      ) : row?.out ? (
        <p>You're out{row.place ? `, finishing ${ordinal(row.place)}` : ""}. Thanks for playing!</p>
      ) : null}
      {row && row.place > 0 && !row.out && !champ && (
        <p>
          You're <b>{ordinal(row.place)}</b>
          {row.value !== null && !isBracket(view.board) ? ` with ${valueText(view, row.value)}` : ""}
        </p>
      )}
    </div>
  );
}

export function PhoneBoard() {
  const { id = "" } = useParams();
  const s = useBoard(id);
  const [me, setMe] = useFollow(id);
  const [tab, setTab] = useState<"standings" | "bracket" | "matches">("standings");
  const view = s.status === "ready" ? s.view : null;
  useEffect(() => {
    if (view) document.title = view.board.title;
  }, [view?.board.title]);
  useEffect(() => {
    if (view && isBracket(view.board)) setTab((t) => (t === "standings" ? "bracket" : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!view && isBracket(view.board)]);
  const names = useMemo(() => (view ? namesOf(view.board) : new Map<string, string>()), [view]);

  if (s.status === "loading") return <p className="muted center pad">Loading…</p>;
  if (!view)
    return (
      <div className="phone">
        <p className="empty">That board is gone.</p>
        <Link to="/">← All boards</Link>
      </div>
    );
  const d = view.derived;
  const b = view.board;
  const bracket = isBracket(b);
  const hasMatches = d.matches.some((m) => m.state !== "bye" && m.state !== "skipped");
  const people = [...b.participants].sort((x, y) => x.name.localeCompare(y.name));
  const recent = d.matches
    .filter((m) => m.state === "done")
    .sort((x, y) => (y.result?.at ?? 0) - (x.result?.at ?? 0))
    .slice(0, 30);
  return (
    <Themed theme={b.theme} className="phone board-page">
      <Link to="/" className="back">
        ← All boards
      </Link>
      <BoardTitle theme={b.theme} title={b.title} subtitle={b.subtitle} />
      {b.status === "finished" && b.winners?.length ? <p className="winner-banner">🏆 {b.winners.join(" & ")}</p> : null}
      {b.status === "draft" && <p className="muted">Starting soon.</p>}

      {people.length > 0 && (
        <label className="follow">
          Follow
          <select value={me} onChange={(e) => setMe(e.target.value)}>
            <option value="">Pick your name…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {me && names.has(me) && b.status !== "draft" && <FollowCard view={view} me={me} />}

      {(bracket || hasMatches) && (
        <nav className="tabs">
          {bracket && (
            <button className={tab === "bracket" ? "on" : ""} onClick={() => setTab("bracket")}>
              Bracket
            </button>
          )}
          <button className={tab === "standings" ? "on" : ""} onClick={() => setTab("standings")}>
            {bracket ? "Places" : "Standings"}
          </button>
          {hasMatches && (
            <button className={tab === "matches" ? "on" : ""} onClick={() => setTab("matches")}>
              Matches
            </button>
          )}
        </nav>
      )}

      {tab === "bracket" && bracket && <BracketScroll view={view} follow={me} />}
      {tab === "standings" && (b.format === "roundrobin" ? <GroupTables view={view} follow={me} compact /> : <StandingsTable view={view} follow={me} compact />)}
      {tab === "matches" && (
        <div className="match-list">
          {d.upNext.length > 0 && <h3>Up next</h3>}
          {d.upNext.map((m) => (
            <MatchLine key={m.id} m={m} names={names} all={d.matches} follow={me} />
          ))}
          {recent.length > 0 && <h3>Results</h3>}
          {recent.map((m) => (
            <MatchLine key={m.id} m={m} names={names} all={d.matches} follow={me} />
          ))}
        </div>
      )}
      <p className="muted small updated">Updated {since(b.updatedAt)}</p>
    </Themed>
  );
}
