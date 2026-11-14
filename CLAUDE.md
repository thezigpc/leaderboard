# Leaderboard: project notes

A scoreboard and tournament app for the **Bar Games box** ("Venuebox"), and usable
standalone. The venue runs its own events: trivia nights, cornhole, pool, darts, and more.
The host keeps score from their phone, and the TVs and players' phones show standings and
brackets live. Several boards can run at once, and each can be themed for its event.

**Status: 0.3.3 (SDK 0.13.2, kit 0.7.4: the TV address wraps onto up to three lines at full size, `lines={3} minScale={0.8}`). 0.3.2 (kit 0.7.3: the TV's "Follow along at" address uses the kit's `<JoinAddress>`, and the TV view works on a portrait screen). 0.3.1: SDK 0.13.0. 0.3.0 released (2026-11-13): hosts who aren't staff can start boards, and the TV cursor fix (below). 0.2.0: the phone-first setup. 0.1.0 had** all six formats, the host, TV, phone and admin pages,
and the box wiring. See "As built" at the end, [README.md](README.md) and
[BARGAMES.md](BARGAMES.md). Keep this file up to date as decisions are made.

## Who uses it

| Role | Device | What it does |
|---|---|---|
| **Host / scorekeeper** | staff phone (often remote: walking the room, at the cornhole lanes) | creates boards, adds players or teams, enters results with a couple of taps, fixes mistakes, picks what the TVs show |
| **TV** (`table` route) | the venue's TVs, cast by the box (or idle TVs) | the live board(s): standings, brackets, "up next", the event's theme, a QR to follow along. No controls. |
| **Player / patron** | phone | follows the boards live: "you're up next on lane 2", their bracket path, the standings. Read-only. |
| **Venue staff (admin)** | iPad / phone | the app's settings, board history, theme presets, who may keep score |

Scoring must be **fast one-handed on a phone**: tap the match, tap the winner (or type
two scores), done. Every change can be undone. Big tap targets, nothing that needs a
keyboard except names.

## Board formats (think these through before coding)

Each board is one event (or one league season) with one format:

1. **Points table**: participants in rows, rounds in columns, totals ranked.
   Trivia night (rounds 1 to 6 plus a bonus), a weekly league table (W/L/points).
   Configurable: points per win/draw/loss, or free-form round scores; sort order (high or
   low wins); tiebreakers (head-to-head, best round, most wins, then shared place).
2. **Single elimination**: a bracket. Seeding manual, random, or from another board's
   standings. Byes when the count isn't a power of two. Optional third-place match.
3. **Double elimination**: winners and losers brackets; losers drop into the right
   losers-bracket round; grand final with an optional "bracket reset" (the
   winners-bracket champion has to lose twice). This is the hard one: get the loser
   placement right for every size from 3 to 64, with byes, and pin it with tests.
4. **Round robin**: everyone plays everyone (optionally in groups), then a points table;
   optionally groups feed a knockout bracket.
5. **Ladder / king of the table**: a ranked list where a challenger who beats someone
   above them takes their place. Good for a running pool ladder over weeks.
6. **Best score / time**: one number per attempt (darts high score, fastest time), best
   per participant, ranked.

Shared rules across formats:

- **Participants** are players or teams (a team has a name and optional members). Add
  them by pasting a list of names, one per line. Late entries where the format allows.
- **Matches** can be best-of-N (pool racks, cornhole games), with scores or just a winner.
  Walkovers/forfeits, and "no-show" removal that re-flows a bracket where possible.
- **Undo and edit:** every result can be changed later; a bracket re-flows from the
  changed match (warn when later matches already have results).
- **Lanes/tables:** optionally assign matches to a lane ("Board 2", "Table 1") and show
  "up next" per lane on the TV and to the players involved.
- **Seasons:** a league can span weeks; a board can be "nightly" or "season", and a
  season board can sum nightly boards.
- **History:** finished boards are archived, with the winner, and can be exported (CSV)
  or copied as a template for next week.

## Multiple boards and the TVs

- Any number of boards; each is draft, live or finished.
- The host picks what the TV view shows: one board, or a rotation of live boards (each N
  seconds), set on the host's phone. A TV cast by the box can't pass a board id, so this
  choice lives in the app; optionally `/tv?board=<id>` for pinning one TV to one board.
- The TV must be readable across a room at 1080p, scale a 32-person double-elimination
  bracket to fit (zoom to the live part when it can't fit), and animate what just changed
  (a new result, a new leader) so people notice.
- The TV runs unattended for hours: survive network blips, pick up changes live without a
  reload (sockets, with polling as fallback).

## Theming for events

- Default: the venue's theme from the box (colors, font, logo).
- Per board: an event theme on top: accent colors, background (solid, gradient, or an
  uploaded image), a title style, an emoji/icon, and an optional sponsor/logo image.
- Presets to start from: Trivia Night, Cornhole, Pool, Darts, Holiday, Tournament Final.
  All original artwork and wording. No sports-league or TV-show trademarks, logos or
  bracket branding ("March Madness" and the like) anywhere.

## The platform: read these first

The box, its SDK and the shared game kit are the user's other projects:

- **Integration guide (the contract):** `C:\CodeProjects\GameBroker\integration\README.md`.
  Read "The rules", "Integration levels", **"Apps (menus, signage…)"**, and every
  "What's new" section from 0.9 down (results, countdowns, attention, announcements,
  path routing).
- **Game kit:** `C:\CodeProjects\GameKit\README.md` and `CHANGELOG.md`. Use it for admin
  sign-in, sockets, sessions, logging, storage and path handling instead of rewriting them.
- **Closest examples:** `C:\CodeProjects\MenuModule` (an **app**, not a game: TV view,
  phone page, settings, the same kind of package as this one) and
  `C:\CodeProjects\BuzzBoard` / `C:\CodeProjects\BingoDigitalGame` (the same stack, kit
  usage, tests and release flow). Read their `CLAUDE.md` and `BARGAMES.md`.
- Vendored here: `vendor/bargames-sdk-0.13.2.tgz`, `vendor/bargames-gamekit-0.7.4.tgz`
  (install as file dependencies, as Bingo does).

### This is an app (`"kind": "app"`)

`bargames.json` declares `sdk.level` 2 so its events are listed; the SDK's manifest check
then warns "apps have no rooms; level 2+ room events and commands won't be used". That's
expected: the box still takes an app's `bg.emit()` events (Home Assistant, the live feed)
and its `bg.reportResults()` (no room code needed). Checked against core on 2026-11-12.

No rooms or join codes. On the box it's installed on the Apps tab, can be cast to TVs
without a room, chosen as what idle TVs show, and as a TV's "When the box starts" choice.
Routes: `player` `/` (the public phone page), `table` `/tv` (the TV view), `host` `/host`
(the scorekeeper's phone UI; linked from the box's Apps tab), `admin` `/admin`.

### Rules that are easy to miss

1. **Standalone must work unchanged.** Off a box the SDK does nothing. `docker compose up`
   runs it alone, with its own admin password.
2. **Stack:** npm workspaces (`shared/`, `server/`, `client/`), TypeScript, Express 4,
   socket.io, React 18 + Vite 5, Node 22 image, `node:test` tests. Same as the others.
3. **Runs under a path** (`https://venue/leaderboard/`): `serveSpa` from the kit, Vite
   `base: "./"`, `serverBase()` for fetches, `socketPath()` for socket.io, router
   `basename={basePath()}`. Declared as `"routing": { "basePath": true }`. Test with
   `npx bargames mock-box --base /leaderboard` (in Git Bash set `MSYS_NO_PATHCONV=1`, or
   use PowerShell).
4. **Shared address:** every app is on one hostname. Prefix every storage key
   (`leaderboard_…`), no `Path=/` cookies, no service worker.
5. **Who may keep score:** staff signed in through the box (`createAdminAuth({
   venuePassword, onBox })`, `adminRouter({ trusted: bg.isStaff })`, `staffSignIn()`),
   plus, per board, an optional **scorekeeper link or PIN** so a trivia host or a league
   captain who isn't staff can score that one board and nothing else. `<BoxAdminLink>` at
   the top of `/admin`.
6. **Box features to use:**
   - `bg.reportResults()` when a board finishes, so the box's "Tonight's winners" counts
     the event winner.
   - `bg.emit()` events for Home Assistant (declare them in `bargames.json`):
     `x-leaderboard-board-started`, `x-leaderboard-result`, `x-leaderboard-leader-changed`,
     `x-leaderboard-board-finished`, plus the standard `winner` on finish. (The brief said
     `board_started` etc.; the box rejects custom names without `x-`, so they were renamed.)
   - `bg.startCountdown()` for "Cornhole starts in 10 min", from the host's phone.
   - `bg.setAttention()` when something needs staff (e.g. a match waiting on a result for
     a long time).
   - Announcements: `<VenueAnnouncement>` on the phone page and the TV view (it hides
     itself where it doesn't belong); lift bottom bars with
     `var(--bargames-announcement-bottom, 0px)`.
7. **TV view:** `tableMode()` / `markSharedScreen()`, the follow-along QR from the box's
   address (`bg.publicUrl()` / `joinUrl()`), no controls.
8. **Phone page:** `<BackToGames />` at the bottom (landing page), announcement at the top.
9. `npx bargames check` must pass before every release.

## Data

- JSON files in `DATA_DIR` (the kit's storage), written atomically; the box gives the
  container a persistent `/data`.
- Server-authoritative: every change goes to the server, which validates it against the
  format's rules and broadcasts the new state. Two staff phones editing at once must not
  lose a result (a version number per board; reject stale edits with a friendly reload).
- Uploaded images (theme backgrounds, logos): size-limited, stored in `DATA_DIR`, served
  under the app's path.
- Export a board as CSV; import participants from pasted text or CSV.

## Not in version 1 (unless the user asks)

Player accounts or sign-ups (the box will provide player identity later), payments or
entry fees, per-point live scoring, public internet sign-up forms.

## Suggested order

1. Data model and the format engines as pure functions in `shared/` with thorough tests
   first: points table, single elimination, then double elimination (every size 3 to 64,
   byes, bracket reset), round robin, ladder, best score.
2. Server: boards, results, undo, versioning, sockets; the host phone UI for points table
   and single elimination; the TV view; the public phone page.
3. Double elimination UI, round robin, ladder, best score.
4. Theming and presets; TV rotation; lanes and "up next".
5. Box wiring (events, results, countdown, attention), `npx bargames check`, release
   0.1.0 to GHCR (the publish workflow is in place), then the user installs it on the box
   with `bgctl install https://github.com/thezigpc/<repo> --enable`.

## Decisions (answered by the user, 2026-11-12)

- **Repo:** `thezigpc/leaderboard` (matches the box id and the image name in
  `bargames.json`).
- **First release (0.1.0) has all six formats:** points table, single elimination,
  double elimination, round robin, ladder, best score.
- **Non-staff scorekeepers:** a **per-board PIN only** (no share link). A scorer opens
  `/host`, enters the board's PIN, and can score that one board and nothing else. Staff
  can change or clear the PIN. This supersedes "scorekeeper link or PIN" in rule 5 above.
- **Double elimination:** the grand-final bracket reset is **on by default**, and can be
  turned off per board.

## Release

- `bargames.json` `version` and `image` tag move together; pushing a changed
  `bargames.json` to main publishes `ghcr.io/thezigpc/<repo>:<version>` (see
  `.github/workflows/publish-image.yml`; the first run is started by hand, and the package
  must be made public once).
- Commits use the user's GitHub no-reply email (already set in this repo's git config).
- The repo will be public: no LAN addresses, hostnames, passwords or anything copied from
  the user's screenshots in code, tests or docs. Use documentation IP ranges
  (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) in examples.

## As built (2026-11-13)

Layout: npm workspaces, the same shape as Menu and Buzz Board. Dev ports: server 3008,
client 5178 (Vite proxies `/api`, `/uploads`, `/__bargames`, `/socket.io`).

- **`shared/src`**: the whole model as pure functions.
  - `types.ts`: a `Board` stores only inputs (participants, seeds, settings, results by match
    id, round scores, league matches, ladder challenges, attempts, lane meta, theme).
    Everything shown is derived.
  - `bracket.ts`: a bracket is a fixed plan (each slot comes from a seed, a match's winner or
    loser); `resolveBracket` resolves it against the results. Byes are values that flow
    through the plan; a withdrawn player becomes a BYE at their next unplayed match; a
    result whose two players no longer fit its slot is "stale" and ignored, which is how a
    bracket re-flows. Losers of winners round r drop into losers round 2(r-1), alternately
    reversed / half-swapped to avoid quick rematches. `bracketPlacings` ranks by how late
    someone went out.
  - `derive.ts`: `derive(board)` per format → matches, standings, columns, up next,
    complete, champion. `ranking.ts`: ranking with tiebreakers applied within tied groups
    (head-to-head is computed for the tied group only); remaining ties share a place.
  - `actions.ts`: `applyAction(board, action, env)`: every change, validated, version
    bumped. A bracket change that would clear later results refuses with `REFLOW` (and the
    list) unless `force`. `season.ts` (season boards sum nightly boards by name), `csv.ts`
    (export, formula-safe), `defaults.ts` (settings, presets, limits), `protocol.ts`.
- **`server/src`**: `boards.ts` (`BoardService`: in memory, one JSON file per board in
  `DATA_DIR/boards`, writes queued per board; version check → 409 `STALE` with the latest
  view; undo stack of 50 in memory), `scorers.ts` (PINs and tokens), `uploads.ts` (images
  checked by their bytes), `bargames.ts` (events, results, attention), `app.ts` (routes and
  socket.io: a client sends `watch { boards, list, tv }` and gets `board`, `boards`, `tv`,
  `removed` pushes).
- **`client/src`**: `live.ts` (one socket; `useBoard(s)`, `useBoardList`, `useTvSettings`,
  HTTP polling while the socket is down), `api.ts`, `pages/` (Phone, Tv, Host, Admin),
  `host/` (score panels per format, result sheet, entrants, setup, `useActions`: queued
  changes, STALE and REFLOW handling), `ui/` (Bracket with the TV camera, Standings,
  Theme, AuthForm).
- **Tests** (`npm test`, 75): every double-elimination size 2–64 with and without the reset
  played out randomly (everyone but the champion loses exactly twice; 2n-2 or 2n-1 matches;
  one 1st, 2nd and 3rd), single elimination 2–128, re-flow, withdrawals, lanes, every
  format's ranking, the API (auth, PINs, staleness, undo, sockets, restart), and the box
  wiring against a fake core.

**Verifying a change:** `npm test`; `npm run build`; `npx bargames validate .`; the mock
box from PowerShell: `npx bargames mock-box . --base /leaderboard --port <p> --core-port <p>
--game http://127.0.0.1:<port>`, the server with the env it prints, `npx bargames check
--game http://127.0.0.1:<port>`; then a Playwright walk-through at 1920x1080 (TV) and a
phone size, through the mock gateway too. Watch the mock's log for `✗` events.

**Things that bit:** the TV layout sizes by height (vh), so a portrait TV needs its own `@media (orientation: portrait)` block (side panel under the board); check portrait and 4K with `mock-box --public-url` and a long address. Anything the TV page puts on the document (tableMode) must be undone on unmount: Back stays in the same document. A TV camera that pans to the bottom of a bracket can't avoid slicing a
card along its top edge, so such cards fade out (`offcam`). The mock box drops custom
events without `x-`.

## Building the list (2026-11-13, after 0.1.0; the user approved mockups 1–8)

The host's setup was rebuilt for phones first. Mockups: https://claude.ai/artifact/T92bWJxyh6kRMTVzzkCKX8

- **Tabs:** before the start, Entrants (or Teams) · Bracket (bracket formats) · Setup; once
  live, Score · Entrants · Setup. The tab follows the status.
- **New board** (`host/NewBoardWizard.tsx`): event tiles (`EVENTS` in `defaults.ts`: look, a
  format, who plays), format cards with small pictures, Players / Pairs / Teams, the name.
- **Who plays** is `board.entry` (`{ kind: "players" | "teams", size }`, size 2 = pairs).
  Team boards keep players not on a team in `board.waiting` (names). Action `entry`; action
  `arrange` sends all teams (by id; no id = new) and the waiting list at once: before the
  start a team left out is removed, after it teams can't be removed and new ones only join
  open formats. The client builds `arrange` and seed swaps from the latest board inside the
  send queue (`run(view => action)` in `useActions`), so quick taps can't undo each other.
- **Quick add** (`QuickAdd.tsx`): one field, Enter adds, keyboard stays; suggestions and
  "Who's here tonight?" (`RegularsSheet.tsx`) come from `GET /api/people` (scorekeepers
  only; `peopleSeen()` in `shared/people.ts`: names from started boards, matched by name).
- **Teams** (`TeamsBoard.tsx`): tap a player, then a team (or another waiting player to pair
  them); drag on wide screens (`useDrag` in `host/kit.tsx`, pointer events, ≥900 px).
  **Blind draw** (`DrawSheet.tsx`): random teams of N, lockable, odd one out sits out or
  joins, made-up names from `TEAM_NAMES` (original, generic).
- **Paste** (`PastePanel.tsx`, beside the list on wide screens, a sheet on phones):
  `readEntrants()` shows how it was read (skipped header, members after "Team:" lines or
  "-" bullets, duplicates with Merge/Skip) before anything is added.
- **Bracket tab** (`BracketSetup.tsx`): phone, round 1 as a list, tap two names to swap;
  wide, the winners bracket drawn out plus a draggable seed list. A board copied from a
  finished one (`board.copiedFrom`) warns when last time's finalists would meet before the
  final (`meetingRound`, `apartSwap` in `bracket.ts`) and offers "Keep them apart".
- Styles for all of this are in `client/src/host.css`. Tests: `shared/test/entrants.test.ts`
  and the pairs/regulars test in `server/test/api.test.ts` (84 in all).

## Hosts who aren't staff (2026-11-13, after 0.2.0)

The user asked for "Start a board" on the players' page, optionally behind a PIN, because
events are sometimes run by a host who isn't staff.

- Admin setting `newBoards`: `"staff"` (the default; no button), `"pin"` (the host PIN,
  hashed like a board PIN in `settings.hostPin`, never sent out: the admin sees
  `hostPinSet`), or `"open"`. `"pin"` with no PIN set behaves as `"staff"`.
  `/api/config` carries the effective `newBoards`; `/api/me` carries `canCreate`.
- `POST /api/host-login` (rate-limited like board PINs) gives a host token (`x-host`
  header, `leaderboard_hostToken`), tied to the PIN's salt, so a new PIN signs hosts out.
- A board started by a non-staff host gets a random 4-digit board PIN, and the response
  carries `scorer: { token, pin }`: the host scores that board only, and the PIN is shown once
  ("Got it") for a second phone. 12 boards per device per hour for non-staff.
- The players' page links to `/host?new`, which opens the wizard (or the host-PIN form).
- Fixed in the same change: the TV page never stopped `tableMode()`, so after Back inside
  the app the pointer stayed hidden and the page stayed marked as a shared screen.

**Not built** (only when asked): a host-run "reveal" mode, per-point live scoring, player
accounts, images on participants, swiss format.
