# Tournament & Leaderboard

Scoreboards and tournament brackets for venue events: trivia nights, cornhole, pool,
darts, leagues. The host keeps score from a phone; the TVs and the players' phones update
live. Several boards can run at once, each with its own event look.

It runs as an app on a Bar Games box, or by itself with `docker compose up`.

## Formats

| Format | For |
|---|---|
| **Points table** | Scores per round (trivia, with a bonus round), or a league table of wins, draws and losses. Ties broken by the last round, the best round or rounds won; or head-to-head, wins, score difference. High or low wins. |
| **Single elimination** | A knockout bracket. Byes go to the top seeds; optional third-place match. |
| **Double elimination** | Winners and losers brackets and a grand final, with an optional bracket reset (on by default). Every size from 2 to 64 is tested. |
| **Round robin** | Everyone plays everyone (once or twice), optionally in groups; then a knockout seeded from the standings. |
| **Ladder** | A ranked list: beat someone above you (within reach) and take their place. |
| **Best score / time** | One number per attempt (high score, fastest time); best attempt counts. |

Setting up is made for a phone: pick the event and format from pictures; add players one
name at a time (Enter adds the next), tick tonight's regulars from earlier boards, or paste
a list and check how it was read. Pairs and teams are cards: tap a player, then their team,
or let a blind draw make random teams. The bracket is the seeding screen: tap two names to
swap them (or drag on an iPad), and it warns when last time's finalists would meet early.

On a Bar Games box, a bracket match can be **played in another game on the box**: "Play in
Pool" on a ready match makes a room in that game for the two players, the match card shows
"playing in Pool, room AB12", and the game's result fills in the bracket by itself. A room
that closes without a result puts the match back to ready, with a note; a result typed in by
hand always wins.

**Seasons** add up nights for a league: boards run here (any format; their places count) and
nights from another game pasted in ("1. Quizzards 52"). Points per place or each night's
total, a TV view of the season table, and "same team, other spelling?" to join names that
split. When adding teams, returning teams are a tap away, and a near-miss spelling asks "Did
you mean Quizzards?" first.

Every result can be changed or undone. Changing a bracket result that later matches were
built on asks first, then re-flows the bracket. A no-show can be withdrawn: their remaining
matches become walkovers. Matches can be put on lanes ("Board 2") and show as "up next".

## Pages

| Path | Who | What |
|---|---|---|
| `/` | players | the live boards; one board's standings, bracket and matches; "follow" your name to see when you're up; "Start a board" when the venue lets hosts start their own |
| `/tv` | the TVs | the live boards in rotation (or `/tv?board=<id>` for one), with up next, latest results and a follow-along QR code. Nothing to click. |
| `/host` | scorekeepers | staff see every board; anyone with a board's PIN can score that board only; a host who started a board scores it |
| `/admin` | staff | settings (including who can start a board: staff only, anyone with the host PIN, or anyone), board history (CSV export, copy as next week's board, delete), saved looks |

## Running it

```bash
cp .env.example .env    # optional
docker compose up -d --build
```

Open `http://localhost:3008/admin` and set the staff password. Data (boards, settings,
uploaded images, the password hash) lives in `./data`.

Development: `npm install`, `npm run dev` (server on :3008, client on :5178), `npm test`.

## On a Bar Games box

Install it from the box's Apps tab with this repo's URL. On a box it uses the venue's name
and colors, staff signed in to the box get straight into the admin, finished boards count
toward "Tonight's winners", events go to Home Assistant, and the scorekeeper page can start
a countdown on the venue's screens. See [BARGAMES.md](BARGAMES.md).
