/**
 * Pairwise "pick similarity" between players over a set of upcoming matches.
 *
 * Instead of inventing a distance metric, similarity reuses the game's own
 * scoring engine ({@link scorePrediction}): we score player A's prediction *as
 * if player B's prediction were the actual result*. Identical picks earn the
 * match maximum (most similar); opposite winners score 0 (least similar); a
 * right winner with a wrong margin lands in between — all weighted exactly the
 * way real points are. The score is symmetric in group stage (result, goals and
 * diff+winner all compare equal-vs-equal), so the matrix is symmetric too.
 *
 * The knockout `advance` criterion depends on team IDs / penalty winners that
 * don't exist for an unplayed match, so it's excluded here — similarity is built
 * from the symmetric core (result + home goals + away goals + diff+winner).
 *
 * Pure & deterministic for unit testing. The caller is responsible for only
 * passing predictions the viewer may see (a round whose lock_time has passed —
 * see RLS notes in CLAUDE.md).
 */

import { scorePrediction, type Stage } from "./scoring";

export interface SimMatch {
  id: string;
  stage: Stage;
}

export interface SimPrediction {
  userId: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
}

export interface SimPlayer {
  userId: string;
  displayName: string;
}

export interface SimilarityMatrix {
  /** Players in the same order as the matrix rows/columns. */
  players: SimPlayer[];
  /**
   * `matrix[i][j]` = similarity 0–1 between `players[i]` and `players[j]`, or
   * `null` when the pair share no predicted match (and on the diagonal — a
   * player's self-cell is left blank so it doesn't dominate the colour scale).
   */
  matrix: (number | null)[][];
  /** `shared[i][j]` = how many matches both players predicted (drives the cell). */
  shared: number[][];
}

/** Max similarity points per match: the scoring core minus the advance bonus. */
function maxCore(stage: Stage): number {
  return stage === "group" ? 10 : 20;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Similarity points for one match: A's prediction scored against B's prediction
 * as the "actual" result, dropping the advance bonus (see module note).
 */
function pairMatchScore(
  a: SimPrediction,
  b: SimPrediction,
  stage: Stage
): number {
  const bd = scorePrediction(
    { home_score_pred: a.homeScore, away_score_pred: a.awayScore },
    { home_score: b.homeScore, away_score: b.awayScore },
    stage
  );
  return bd.total - bd.advance;
}

/**
 * Builds the symmetric pick-similarity matrix for `players` over `matches`.
 * A pair's similarity is the sum of per-match similarity points over the
 * matches both predicted, divided by the maximum obtainable on those matches.
 */
export function computePickSimilarity(
  players: SimPlayer[],
  matches: SimMatch[],
  predictions: SimPrediction[]
): SimilarityMatrix {
  const stageById = new Map(matches.map((m) => [m.id, m.stage]));

  // userId → (matchId → prediction), restricted to the matches in scope.
  const byUser = new Map<string, Map<string, SimPrediction>>();
  for (const p of predictions) {
    if (!stageById.has(p.matchId)) continue;
    let m = byUser.get(p.userId);
    if (!m) {
      m = new Map();
      byUser.set(p.userId, m);
    }
    m.set(p.matchId, p);
  }

  const n = players.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () =>
    Array<number | null>(n).fill(null)
  );
  const shared: number[][] = Array.from({ length: n }, () =>
    Array<number>(n).fill(0)
  );

  for (let i = 0; i < n; i++) {
    const predsI = byUser.get(players[i]!.userId);
    for (let j = i + 1; j < n; j++) {
      const predsJ = byUser.get(players[j]!.userId);

      let scoreSum = 0;
      let maxSum = 0;
      let count = 0;
      for (const m of matches) {
        const pa = predsI?.get(m.id);
        const pb = predsJ?.get(m.id);
        if (!pa || !pb) continue;
        scoreSum += pairMatchScore(pa, pb, m.stage);
        maxSum += maxCore(m.stage);
        count += 1;
      }

      const sim = maxSum > 0 ? round2(scoreSum / maxSum) : null;
      matrix[i]![j] = sim;
      matrix[j]![i] = sim;
      shared[i]![j] = count;
      shared[j]![i] = count;
    }
  }

  return { players, matrix, shared };
}

export interface RankedPlayer extends SimPlayer {
  /** Leaderboard rank (1 = best). */
  rank: number;
}

/**
 * Picks up to `size` players to display: the selected player plus their nearest
 * leaderboard neighbours. Returns them ordered by rank (ascending), sliding the
 * window at the edges so a top- or bottom-ranked selection still yields `size`
 * rows. Ties break by userId for determinism.
 */
export function selectNeighbours(
  ranked: RankedPlayer[],
  selectedId: string,
  size: number
): RankedPlayer[] {
  const sorted = ranked
    .slice()
    .sort((a, b) => a.rank - b.rank || a.userId.localeCompare(b.userId));

  if (sorted.length <= size) return sorted;

  const idx = sorted.findIndex((p) => p.userId === selectedId);
  if (idx === -1) return sorted.slice(0, size);

  const half = Math.floor(size / 2);
  let start = idx - half;
  if (start < 0) start = 0;
  if (start + size > sorted.length) start = sorted.length - size;
  return sorted.slice(start, start + size);
}
