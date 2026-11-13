// Ranking with tiebreakers, shared by every table-style format.
//
// Sort by the primary value; within each group of equal values apply the next tiebreaker
// (computed for that group only, which is what head-to-head needs); whoever is still tied
// after the last one shares a place (1, 2, 2, 4).

/** Values where bigger is better. Return undefined to leave someone unranked (no place). */
export type Tiebreaker = (group: string[]) => Map<string, number>;

export function rankIds(ids: string[], primary: Map<string, number>, tiebreakers: Tiebreaker[]): Map<string, number> {
  const places = new Map<string, number>();
  const ranked = ids.filter((id) => primary.has(id));
  let pos = 0;
  const assign = (group: string[], values: Map<string, number>, rest: Tiebreaker[]) => {
    const sorted = [...group].sort((x, y) => values.get(y)! - values.get(x)!);
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && values.get(sorted[j]) === values.get(sorted[i])) j++;
      const tied = sorted.slice(i, j);
      if (tied.length > 1 && rest.length) {
        assign(tied, rest[0](tied), rest.slice(1));
      } else {
        for (const id of tied) places.set(id, pos + 1);
        pos += tied.length;
      }
      i = j;
    }
  };
  assign(ranked, primary, tiebreakers);
  return places;
}

/** A head-to-head / league record. */
export interface Record {
  p: number;
  w: number;
  d: number;
  l: number;
  f: number;
  a: number;
  pts: number;
}

export const emptyRecord = (): Record => ({ p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, pts: 0 });

export interface PlayedMatch {
  a: string;
  b: string;
  winner: string | null;
  scoreA?: number;
  scoreB?: number;
}

/** Each participant's record from the played matches (only matches among `ids` count). */
export function records(ids: string[], played: PlayedMatch[], pts: { win: number; draw: number; loss: number }): Map<string, Record> {
  const recs = new Map(ids.map((id) => [id, emptyRecord()]));
  for (const m of played) {
    const ra = recs.get(m.a);
    const rb = recs.get(m.b);
    if (!ra || !rb) continue;
    ra.p++;
    rb.p++;
    ra.f += m.scoreA ?? 0;
    ra.a += m.scoreB ?? 0;
    rb.f += m.scoreB ?? 0;
    rb.a += m.scoreA ?? 0;
    if (m.winner === null) {
      ra.d++;
      rb.d++;
      ra.pts += pts.draw;
      rb.pts += pts.draw;
    } else {
      const [w, l] = m.winner === m.a ? [ra, rb] : [rb, ra];
      w.w++;
      l.l++;
      w.pts += pts.win;
      l.pts += pts.loss;
    }
  }
  return recs;
}
