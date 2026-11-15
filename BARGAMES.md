# Bar Games integration: Tournament & Leaderboard (app)

**`kind: "app"`, sdk.level 2, `"tournaments": true`, SDK 0.15.0, game kit 0.8.0.** No rooms
of its own. Display name "Tournament & Leaderboard"; the id stays `leaderboard` (and the
repo and image), so an installed box and its data carry on. What it takes from the box: the
venue's name, theme and address, staff sign-in, announcements, and games that play bracket
matches. What it gives the box: events, finished boards' results, a countdown, and "needs
attention" items.

## Manifest

`bargames.json`: id `leaderboard`, port 3008, routes `player /`, `table /tv`, `host /host`,
`admin /admin`, `routing.basePath: true`, `network.internet: false`, `env.DATA_DIR=/data`,
256m. `npx bargames validate .` passes with two expected warnings (not pinned by digest;
"apps have no rooms" for level 2). Status always answers `{ rooms: [] }`.

## `npx bargames check` (mock box with `--base /leaderboard`, the app on a spare port)

```
leaderboard@0.1.0 · level 2 · http://127.0.0.1:3119
✓ health /health → 200
✓ /__bargames/venue.json returns the box's branding ("Leaderboard (mock)")
✓ /__bargames/theme.css served
✓ phone page (routes.player) / → 200
✓ TV view (routes.table) /tv → 200

all checks passed
```

## Events (`server/src/bargames.ts`, `announceChange`)

Custom events start with `x-` (the box rejects other non-standard names; the brief's
`board_started` etc. were renamed when the mock box refused them).

| Event | When | `data` |
|---|---|---|
| `x-leaderboard-board-started` | a board goes live | `{ boardId, title, format, entrants }` |
| `x-leaderboard-result` | a match result, a round score or an attempt | match: `{ boardId, title, format, match, winner, loser, draw, score ("7-2", winner first), lane }`; score/attempt: `{ boardId, title, format, name, value }` |
| `x-leaderboard-leader-changed` | a live board gets a new sole leader | `{ boardId, title, format, leader }` |
| `x-leaderboard-board-finished` | a board is finished | `{ boardId, title, format, winners }` |
| `winner` (standard) | a board is finished, once per winner | `{ name, boardId, title, format }` |
| `game_result` (standard) | sent by `bg.reportResults()` on finish | the placings |

`bg.reportResults({ results: [{ player: { name }, place, score? }] })` is sent when a board
finishes (up to 50 placed entrants), no room code. All events are fire-and-forget and only
on a box. Checked on the mock box: every event accepted (`●`), none rejected.

## Commands

`match_result` (SDK 0.15.0), registered by `bg.matches.onResult` in `server/src/matches.ts`.

## Bracket matches in other games (SDK 0.15.0)

- `GET /api/match-games` (scorekeepers): `bg.matches.games()` filtered to games whose player
  range includes 2 (cached 15 s). Empty off a box, so the host page shows nothing.
- `POST /api/boards/:id/matches/:matchId/play { gameId }`: the match must be ready (both
  sides known, no result). `bg.matches.start({ gameId, matchId: "<board>.<match>.<nonce>",
  players: [{ name, id: <participant id> }] ×2, title: "<board title>: <label>" })`. The
  nonce makes a fresh box match each time, so a match played again after a cancelled room
  gets a new room. The link is stored as `board.meta[matchId].game` through the server-only
  action `gameLink` (phones can't send it: 400).
- Derived matches carry `game: { name, room, joinUrl? }` while the same two players are
  still on that match and it has no result; the host's result sheet, the match lines (host,
  TV, phones) and the bracket cards show it.
- `match_result` done: place 1 wins (matched by the id we sent, then by name; with no
  places, the higher score of two). Scores go in when both are given and agree with the
  winner (a game whose score runs the other way still decides the winner). The result is
  recorded as a normal `result` action, so the bracket moves on, events fire and undo works.
- `match_result` cancelled: the link is cleared and the match is ready again with a note
  ("Pool room AB12 closed without a result…").
- A result typed in by hand clears the link; a later `match_result` for it finds nothing and
  is ignored. So does one for a match whose players changed (the bracket re-flowed).
- `bg.matches.get()` is polled at start and every 3 minutes for linked matches, to catch a
  result sent while the app was restarting.
- TVs for the match (`displayIds`) aren't used yet: the box doesn't list its TVs to apps.

## Seasons and `game_result`

An app can't read other games' `game_result` (the venue context only carries tonight's
winners), so a season is built from boards run here and nights typed or pasted in by
staff. When the box can hand an app other games' results, a season could pull trivia
nights in by itself.

## Countdown and attention

- `POST /api/countdown { label, minutes }` (staff or any scorekeeper) → `bg.startCountdown`;
  `DELETE` → `bg.clearCountdown`. The host page shows the control only on a box; standalone
  the route answers 400.
- Every minute (and after each change) the app sends `bg.setAttention` with the matches
  called to a lane that have waited longer than the admin's setting (default 20 min) for a
  result: `"Cornhole: Ann vs Bo on Board 2 has waited 25 min for a result"`, `actionPath:
  /host/<boardId>`. Sent only when the list changes; `[]` clears it.

## Staff and scorekeepers

- Kit admin auth: `createAdminAuth({ venuePassword: bg.checkVenuePassword, onBox: bg.connected })`,
  `adminRouter({ trusted: bg.isStaff })`, `staffSignIn()` on `/host` and `/admin`,
  `<BoxAdminLink>` at the top of `/admin`.
- Per-board scorekeeper PIN (4–8 digits, scrypt-hashed on the board). The PIN gives a
  24-hour HMAC token for that board only, tied to the PIN's salt, so a new PIN or none signs
  them out. Wrong PINs: 6 per device and 30 per board per 10 minutes.

## Path routing (`/leaderboard/`)

`serveSpa` from the kit; Vite `base: "./"`; every fetch through the SDK's `bgUrl`;
socket.io at `socketPath()`; router `basename={basePath()}`; QR codes from the SDK's
`joinUrl(venue, "/b/<id>")` (the venue's public address on a box). Storage keys are
prefixed `leaderboard_`; no cookies; no service worker. Checked through the mock gateway:
phone, board, host, admin and TV pages load under `/leaderboard/` with no 4xx and no page
errors; box staff sign-in through `/__bargames/staff?next=/leaderboard/admin` lands in the
admin signed in.

## TV view (`/tv`)

- [x] Opens with no prompt or gesture; shows the live boards in rotation, or the host's choice,
      or `/tv?board=<id>`.
- [x] No audio.
- [x] Fills 1920×1080 without scrolling (checked for every format). Text 2.6vh and up;
      standings rows 3.4vh; tables page through when they don't fit; brackets fit when
      readable, otherwise the camera zooms in on the live matches and pages between them.
- [x] Recovers on its own: socket.io reconnects, HTTP polling every 15 s meanwhile,
      `tableMode` shows "Reconnecting…", and the page reloads itself when the server's
      client build changes. A crash screen retries every 10 s.
- [x] Light animation: a flash on what changed, "New leader" for 6 s, a slow camera pan.
- [x] No pointer: `tableMode()` on a box (pointer hidden, wake lock, shared-screen marker);
      `<VenueAnnouncement>` follows `show`/`position`, and the layout lifts above a bottom strip.

## Container

Writes only under `DATA_DIR`: `admin.json`, `settings.json`, `secret.json`,
`boards/<id>.json`, `uploads/`. Runs as `node`, `read_only: true`, `cap_drop: ALL` in the
compose file. This PC has no Docker; the image is built by the publish workflow from a clean
checkout.

## Standalone

Nothing box-only runs off a box: no events, no countdown control, the admin's own password
and first-run setup, the app's own name setting. Tests: `server/test/bargames.test.ts`
(standalone and a fake box core).

## SDK requests

- `GameEventInput["type"]` only allows standard or `x-` names while `bargames validate`
  accepts any snake_case event name. The validator could warn about non-`x-` custom names,
  so an app finds out before the box drops its events.
