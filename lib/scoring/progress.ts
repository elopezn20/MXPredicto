import type { LeaderboardUser } from "./scoring";

export interface ProgressPredictionInput {
  userId: string;
  matchId: string;
  pointsAwarded: number | null;
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

/**
 * Builds the rank-over-time trajectory for a single target user.
 *
 * Walks the finished matches in chronological order, accumulating every user's
 * running points (and hit/zero counts), and records the target user's rank in
 * the standings after each match. Ranking mirrors {@link computeLeaderboard}:
 * total points (desc) → matches hit (desc) → zero matches (asc).
 *
 * A "hit" is a match worth exactly 10 points; a "zero" is any finished match
 * worth 0 points (including matches the user never predicted).
 *
 * @param users            All ranked players.
 * @param orderedMatchIds  Finished match IDs in chronological order.
 * @param predictions      Scored predictions across all users (only finished
 *                         matches are consulted).
 * @param targetUserId     The user whose trajectory to return.
 */
export function computeRankTrajectory(
  users: LeaderboardUser[],
  orderedMatchIds: string[],
  predictions: ProgressPredictionInput[],
  targetUserId: string
): RankPoint[] {
  const finishedSet = new Set(orderedMatchIds);

  // "userId:matchId" → points
  const predMap = new Map<string, number>();
  for (const p of predictions) {
    if (finishedSet.has(p.matchId)) {
      predMap.set(`${p.userId}:${p.matchId}`, p.pointsAwarded ?? 0);
    }
  }

  type Agg = { total: number; hit: number; zero: number };
  const agg = new Map<string, Agg>();
  for (const u of users) agg.set(u.id, { total: 0, hit: 0, zero: 0 });

  const totalPlayers = users.length;
  const trajectory: RankPoint[] = [];

  orderedMatchIds.forEach((matchId, index) => {
    // Apply this match's results to every user's running totals.
    for (const u of users) {
      const entry = agg.get(u.id)!;
      const pts = predMap.get(`${u.id}:${matchId}`) ?? 0;
      entry.total += pts;
      if (pts === 10) entry.hit += 1;
      if (pts === 0) entry.zero += 1;
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
      matchId,
      rank: ahead + 1,
      totalPlayers,
      cumulativePoints: target.total,
      pointsThisMatch: predMap.get(`${targetUserId}:${matchId}`) ?? 0,
    });
  });

  return trajectory;
}
