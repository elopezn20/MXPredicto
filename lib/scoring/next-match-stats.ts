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
  /**
   * Spread across the three results (home win / draw / away win), 0–1
   * (normalized Shannon entropy over the outcome buckets). 0 = everyone agrees
   * on the result, 1 = a perfectly even three-way split.
   */
  outcomeSpread: number;
  /**
   * True when there's no clear favourite result — the leading outcome is short
   * of a majority, so the pool is genuinely split on home/draw/away. Requires a
   * minimum sample so a few differing picks don't trip it.
   */
  highVariety: boolean;
  /** Single most-predicted exact scoreline (null when no predictions). */
  mode: Scoreline | null;
  /** Mean predicted goals, one decimal, null when no predictions. */
  avgHome: number | null;
  avgAway: number | null;
  homeWins: OutcomeBucket;
  draws: OutcomeBucket;
  awayWins: OutcomeBucket;
}

/** Below this many predictions the spread signal is too noisy to flag. */
const MIN_TOTAL_FOR_VARIETY = 8;
/**
 * When the leading result (home/draw/away) holds at most this share of all
 * predictions, no outcome has a majority (>50%) and we flag high variety.
 */
const MAJORITY_SHARE = 0.5;

const EMPTY_BUCKET: OutcomeBucket = { count: 0, pct: 0, top: [] };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
      outcomeSpread: 0,
      highVariety: false,
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

  const homeWins = buildBucket((s) => s.home > s.away);
  const draws = buildBucket((s) => s.home === s.away);
  const awayWins = buildBucket((s) => s.home < s.away);

  // Spread is measured over the three results, not exact scorelines — a pool
  // split between 1-0, 2-1 and 3-0 all agree it's a home win. Normalized
  // Shannon entropy over the outcome buckets: 0 = one result is certain, 1 = a
  // perfectly even home/draw/away split. Flag "high variety" only when no
  // single result reaches a majority (and we have enough predictions).
  const outcomeCounts = [homeWins.count, draws.count, awayWins.count];
  const entropy = outcomeCounts.reduce((sum, c) => {
    if (c === 0) return sum;
    const p = c / total;
    return sum - p * Math.log(p);
  }, 0);
  const outcomeSpread = round2(entropy / Math.log(3));
  const leadShare = Math.max(...outcomeCounts) / total;
  const highVariety =
    total >= MIN_TOTAL_FOR_VARIETY && leadShare <= MAJORITY_SHARE;

  return {
    total,
    outcomeSpread,
    highVariety,
    mode,
    avgHome: round1(sumHome / total),
    avgAway: round1(sumAway / total),
    homeWins,
    draws,
    awayWins,
  };
}
