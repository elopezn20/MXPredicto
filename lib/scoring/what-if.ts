import {
  scorePrediction,
  type LeaderboardRow,
  type Stage,
} from "./scoring";

export interface WhatIfPrediction {
  userId: string;
  homeScore: number;
  awayScore: number;
  penaltyWinnerTeamId: string | null;
}

export interface WhatIfResult {
  homeScore: number;
  awayScore: number;
  /**
   * Team advancing on penalties when the hypothetical knockout result is a
   * draw. Ignored for group-stage matches and non-draw knockout results
   * (there the FT winner advances).
   */
  advancingTeamId: string | null;
  homeTeamId: string;
  awayTeamId: string;
}

export type WhatIfRow<T extends LeaderboardRow = LeaderboardRow> = T & {
  /** Points this player's pick would earn from the hypothetical result. */
  gained: number;
  /** Rank movement vs the real scoreboard: positive = would move up. */
  moveVsReal: number;
};

/**
 * Re-ranks a leaderboard as if the next match finished with `result`.
 *
 * Takes the real leaderboard rows (already aggregated over finished matches),
 * scores every player's locked-in pick for the next match against the
 * hypothetical result with the same scoring rules, folds the points into each
 * player's totals (including hit/zero counters, which participate in
 * tie-breaks), and re-ranks with the standard ordering: total points desc →
 * hits desc → zeros asc. Players without a pick score 0 (a zero-match), same
 * as a real unsubmitted prediction.
 *
 * Extra fields on the input rows are preserved so callers can carry display
 * data (names, picks, flags) through the re-rank.
 */
export function computeWhatIfLeaderboard<T extends LeaderboardRow>(
  baseRows: T[],
  predictions: WhatIfPrediction[],
  result: WhatIfResult,
  stage: Stage
): Array<WhatIfRow<T>> {
  const maxPoints = stage === "group" ? 10 : 25;
  const predByUser = new Map(predictions.map((p) => [p.userId, p]));

  const isDraw = result.homeScore === result.awayScore;
  // In a non-draw knockout result the FT winner is the advancing team.
  const advancingTeamId =
    stage === "knockout" && !isDraw
      ? result.homeScore > result.awayScore
        ? result.homeTeamId
        : result.awayTeamId
      : result.advancingTeamId;

  const entries = baseRows.map((row) => {
    const p = predByUser.get(row.userId);
    const gained = scorePrediction(
      p
        ? {
            home_score_pred: p.homeScore,
            away_score_pred: p.awayScore,
            penalty_winner_team_id: p.penaltyWinnerTeamId,
          }
        : null,
      {
        home_score: result.homeScore,
        away_score: result.awayScore,
        advancing_team_id: advancingTeamId,
        home_team_id: result.homeTeamId,
        away_team_id: result.awayTeamId,
      },
      stage
    ).total;
    return {
      ...row,
      totalPoints: row.totalPoints + gained,
      matchesHit: row.matchesHit + (gained === maxPoints ? 1 : 0),
      zeroMatches: row.zeroMatches + (gained === 0 ? 1 : 0),
      gained,
    };
  });

  entries.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.matchesHit !== a.matchesHit) return b.matchesHit - a.matchesHit;
    return a.zeroMatches - b.zeroMatches;
  });

  const leaderPoints = entries.length > 0 ? entries[0]!.totalPoints : 0;
  const realRankByUser = new Map(baseRows.map((r) => [r.userId, r.rank]));

  const rows: Array<WhatIfRow<T>> = [];
  let currentRank = 1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (i > 0) {
      const prev = entries[i - 1]!;
      const tied =
        e.totalPoints === prev.totalPoints &&
        e.matchesHit === prev.matchesHit &&
        e.zeroMatches === prev.zeroMatches;
      if (!tied) currentRank = i + 1;
    }
    rows.push({
      ...e,
      rank: currentRank,
      deltaFromLeader: e.totalPoints - leaderPoints,
      moveVsReal: (realRankByUser.get(e.userId) ?? currentRank) - currentRank,
    });
  }
  return rows;
}
