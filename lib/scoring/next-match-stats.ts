/**
 * Aggregate stats over all players' predictions for a single (upcoming) match.
 *
 * Pure & deterministic so it can be unit-tested in isolation. The calling page
 * is responsible for only passing in predictions the viewer is allowed to see
 * (i.e. for a round whose lock_time has passed — see RLS in CLAUDE.md).
 */

export interface RawPrediction {
  userId: string;
  homeScore: number;
  awayScore: number;
}

export interface Scoreline {
  /** Formatted as "home-away", e.g. "2-1". */
  label: string;
  home: number;
  away: number;
  count: number;
}

export interface OutcomeBucket {
  count: number;
  /** Share of all predictions, 0–100, rounded to one decimal. */
  pct: number;
  /** Up to `topN` most-common scorelines for this outcome, count desc. */
  top: Scoreline[];
}

export interface NextMatchStats {
  total: number;
  /** Single most-predicted exact scoreline (null when no predictions). */
  mode: Scoreline | null;
  /** Mean predicted goals, one decimal, null when no predictions. */
  avgHome: number | null;
  avgAway: number | null;
  homeWins: OutcomeBucket;
  draws: OutcomeBucket;
  awayWins: OutcomeBucket;
}

const EMPTY_BUCKET: OutcomeBucket = { count: 0, pct: 0, top: [] };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Stable ordering for scorelines: highest count first, then lowest home, then
 * lowest away — so output is deterministic regardless of input order.
 */
function byCountThenScore(a: Scoreline, b: Scoreline): number {
  if (b.count !== a.count) return b.count - a.count;
  if (a.home !== b.home) return a.home - b.home;
  return a.away - b.away;
}

export function computeNextMatchStats(
  predictions: RawPrediction[],
  topN = 3
): NextMatchStats {
  const total = predictions.length;
  if (total === 0) {
    return {
      total: 0,
      mode: null,
      avgHome: null,
      avgAway: null,
      homeWins: EMPTY_BUCKET,
      draws: EMPTY_BUCKET,
      awayWins: EMPTY_BUCKET,
    };
  }

  const counts = new Map<string, Scoreline>();
  let sumHome = 0;
  let sumAway = 0;

  for (const p of predictions) {
    sumHome += p.homeScore;
    sumAway += p.awayScore;
    const label = `${p.homeScore}-${p.awayScore}`;
    const existing = counts.get(label);
    if (existing) existing.count++;
    else counts.set(label, { label, home: p.homeScore, away: p.awayScore, count: 1 });
  }

  const allScorelines = [...counts.values()];
  const mode = allScorelines.slice().sort(byCountThenScore)[0] ?? null;

  const buildBucket = (filter: (s: Scoreline) => boolean): OutcomeBucket => {
    const lines = allScorelines.filter(filter).sort(byCountThenScore);
    const count = lines.reduce((sum, s) => sum + s.count, 0);
    return {
      count,
      pct: round1((count / total) * 100),
      top: lines.slice(0, topN),
    };
  };

  return {
    total,
    mode,
    avgHome: round1(sumHome / total),
    avgAway: round1(sumAway / total),
    homeWins: buildBucket((s) => s.home > s.away),
    draws: buildBucket((s) => s.home === s.away),
    awayWins: buildBucket((s) => s.home < s.away),
  };
}
