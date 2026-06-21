import type { LeaderboardUser, Stage } from "./scoring";

export interface ProgressPredictionInput {
  userId: string;
  matchId: string;
  pointsAwarded: number | null;
}

/** A finished match with the stage that determines its maximum points. */
export interface FinishedMatch {
  id: string;
  stage: Stage;
}

export interface RankPoint {
  /** 0-based position of the match within the ordered finished-match list. */
  index: number;
  matchId: string;
  /** The target user's leaderboard rank after this match (1 = best). */
  rank: number;
  /** Total number of ranked players (denominator for the rank). */
  totalPlayers: number;
  /** The target user's cumulative points up to and including this match. */
  cumulativePoints: number;
  /** Points the target user earned on this specific match (0 if none). */
  pointsThisMatch: number;
}

/** Maximum points obtainable for a match — 10 in group stage, 25 in knockout. */
function maxPoints(stage: Stage): number {
  return stage === "group" ? 10 : 25;
}

/**
 * Builds the rank-over-time trajectory for a single target user.
 *
 * Walks the finished matches in chronological order, accumulating every user's
 * running points (and hit/zero counts), and records the target user's rank in
 * the standings after each match. Ranking mirrors {@link computeLeaderboard}:
 * total points (desc) → matches hit (desc) → zero matches (asc).
 *
 * A "hit" is a perfect prediction (the match maximum: 10 group / 25 knockout);
 * a "zero" is any finished match worth 0 points (including matches the user
 * never predicted). Partial scores (>0 but <max) are neither.
 *
 * @param users            All ranked players.
 * @param orderedMatches   Finished matches (id + stage) in chronological order.
 * @param predictions      Scored predictions across all users (only finished
 *                         matches are consulted).
 * @param targetUserId     The user whose trajectory to return.
 */
export function computeRankTrajectory(
  users: LeaderboardUser[],
  orderedMatches: FinishedMatch[],
  predictions: ProgressPredictionInput[],
  targetUserId: string
): RankPoint[] {
  const maxByMatch = new Map<string, number>();
  for (const m of orderedMatches) maxByMatch.set(m.id, maxPoints(m.stage));

  // "userId:matchId" → points
  const predMap = new Map<string, number>();
  for (const p of predictions) {
    if (maxByMatch.has(p.matchId)) {
      predMap.set(`${p.userId}:${p.matchId}`, p.pointsAwarded ?? 0);
    }
  }

  type Agg = { total: number; hit: number; zero: number };
  const agg = new Map<string, Agg>();
  for (const u of users) agg.set(u.id, { total: 0, hit: 0, zero: 0 });

  const totalPlayers = users.length;
  const trajectory: RankPoint[] = [];

  orderedMatches.forEach((match, index) => {
    const max = maxByMatch.get(match.id)!;

    // Apply this match's results to every user's running totals.
    for (const u of users) {
      const entry = agg.get(u.id)!;
      const pts = predMap.get(`${u.id}:${match.id}`) ?? 0;
      entry.total += pts;
      if (pts === max) entry.hit += 1;
      else if (pts === 0) entry.zero += 1;
    }

    const target = agg.get(targetUserId);
    if (!target) return; // target not among ranked users

    // Rank = 1 + number of users strictly ahead on the tiebreaker ordering.
    let ahead = 0;
    for (const u of users) {
      if (u.id === targetUserId) continue;
      const e = agg.get(u.id)!;
      if (
        e.total > target.total ||
        (e.total === target.total && e.hit > target.hit) ||
        (e.total === target.total &&
          e.hit === target.hit &&
          e.zero < target.zero)
      ) {
        ahead += 1;
      }
    }

    trajectory.push({
      index,
      matchId: match.id,
      rank: ahead + 1,
      totalPlayers,
      cumulativePoints: target.total,
      pointsThisMatch: predMap.get(`${targetUserId}:${match.id}`) ?? 0,
    });
  });

  return trajectory;
}

export interface PlayerRankStats {
  userId: string;
  displayName: string;
  totalPoints: number;
  /** Standing after the last finished match (1 = best). */
  currentRank: number;
  /** Best (lowest) rank reached at any point in the season; null if no matches. */
  bestRank: number | null;
  /** Worst (highest) rank reached at any point; null if no matches. */
  worstRank: number | null;
  hits: number;
  zeros: number;
}

/**
 * Computes per-player season stats for every user: best/worst rank reached over
 * the course of the finished matches, plus final standing, hits and zeros.
 *
 * Ranking at each step uses the same ordering as {@link computeLeaderboard}
 * (total → hits → zeros) with standard competition ranking (ties share a rank,
 * the next distinct entry skips ahead). Hits and zeros follow the same per-match
 * definitions as {@link computeRankTrajectory}.
 */
export function computePlayerRankStats(
  users: LeaderboardUser[],
  orderedMatches: FinishedMatch[],
  predictions: ProgressPredictionInput[]
): PlayerRankStats[] {
  const maxByMatch = new Map<string, number>();
  for (const m of orderedMatches) maxByMatch.set(m.id, maxPoints(m.stage));

  const predMap = new Map<string, number>();
  for (const p of predictions) {
    if (maxByMatch.has(p.matchId)) {
      predMap.set(`${p.userId}:${p.matchId}`, p.pointsAwarded ?? 0);
    }
  }

  type Agg = { total: number; hit: number; zero: number };
  const agg = new Map<string, Agg>();
  const best = new Map<string, number | null>();
  const worst = new Map<string, number | null>();
  for (const u of users) {
    agg.set(u.id, { total: 0, hit: 0, zero: 0 });
    best.set(u.id, null);
    worst.set(u.id, null);
  }

  // Ranks everyone given the current running aggregates (competition ranking).
  const rankAll = (): Map<string, number> => {
    const sorted = users.slice().sort((a, b) => {
      const sa = agg.get(a.id)!;
      const sb = agg.get(b.id)!;
      if (sb.total !== sa.total) return sb.total - sa.total;
      if (sb.hit !== sa.hit) return sb.hit - sa.hit;
      return sa.zero - sb.zero;
    });
    const ranks = new Map<string, number>();
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prev = agg.get(sorted[i - 1]!.id)!;
        const cur = agg.get(sorted[i]!.id)!;
        const tied =
          cur.total === prev.total &&
          cur.hit === prev.hit &&
          cur.zero === prev.zero;
        if (!tied) currentRank = i + 1;
      }
      ranks.set(sorted[i]!.id, currentRank);
    }
    return ranks;
  };

  for (const match of orderedMatches) {
    const max = maxByMatch.get(match.id)!;
    for (const u of users) {
      const e = agg.get(u.id)!;
      const pts = predMap.get(`${u.id}:${match.id}`) ?? 0;
      e.total += pts;
      if (pts === max) e.hit += 1;
      else if (pts === 0) e.zero += 1;
    }
    const ranks = rankAll();
    for (const u of users) {
      const r = ranks.get(u.id)!;
      const b = best.get(u.id);
      const w = worst.get(u.id);
      best.set(u.id, b == null ? r : Math.min(b, r));
      worst.set(u.id, w == null ? r : Math.max(w, r));
    }
  }

  const finalRanks = orderedMatches.length
    ? rankAll()
    : new Map<string, number>();

  return users.map((u) => {
    const e = agg.get(u.id)!;
    return {
      userId: u.id,
      displayName: u.displayName,
      totalPoints: e.total,
      currentRank: finalRanks.get(u.id) ?? 1,
      bestRank: best.get(u.id) ?? null,
      worstRank: worst.get(u.id) ?? null,
      hits: e.hit,
      zeros: e.zero,
    };
  });
}
