export type Stage = "group" | "knockout";

export interface Prediction {
  home_score_pred: number;
  away_score_pred: number;
  penalty_winner_team_id?: string | null;
}

export interface ActualResult {
  home_score: number | null;
  away_score: number | null;
  penalty_winner_team_id?: string | null;
  advancing_team_id?: string | null;
}

export interface ScoreBreakdown {
  result: number;
  homeGoals: number;
  awayGoals: number;
  diffAndWinner: number;
  advance: number;
  total: number;
}

export interface PodioPrediction {
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  third_place_team_id: string | null;
}

export interface PodioActual {
  champion_team_id: string | null;
  runner_up_team_id: string | null;
  third_place_team_id: string | null;
}

export interface LeaderboardUser {
  id: string;
  displayName: string;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  totalPoints: number;
  matchesHit: number;
  zeroMatches: number;
  deltaFromLeader: number;
}

const ZERO: ScoreBreakdown = {
  result: 0,
  homeGoals: 0,
  awayGoals: 0,
  diffAndWinner: 0,
  advance: 0,
  total: 0,
};

type MatchResult = "home" | "away" | "draw";

function winner(home: number, away: number): MatchResult {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

/**
 * Pure scoring function. Returns breakdown of points awarded for a single match prediction.
 *
 * Group stage (max 10): result 5, home goals 2, away goals 2, diff+winner 1.
 * Knockout (max 25): result 10, home goals 4, away goals 4, diff+winner 2, advance 5.
 * In knockout, a wrong result (who wins at FT/ET) scores 0 for all criteria.
 *
 * "diff+winner" is awarded when predicted goal difference equals actual AND the same
 * side wins — including draws, where diff=0 counts as "correct difference" and
 * "draw" counts as "correct winner."
 */
export function scorePrediction(
  prediction: Prediction | null | undefined,
  actual: ActualResult | null | undefined,
  stage: Stage
): ScoreBreakdown {
  if (
    !prediction ||
    actual?.home_score == null ||
    actual?.away_score == null
  ) {
    return { ...ZERO };
  }

  const { home_score_pred: hp, away_score_pred: ap } = prediction;
  const { home_score: ha, away_score: aa } = actual;

  const predResult = winner(hp, ap);
  const actualResult = winner(ha, aa);
  const resultCorrect = predResult === actualResult;

  const predDiff = hp - ap;
  const actualDiff = ha - aa;

  if (stage === "group") {
    const result = resultCorrect ? 5 : 0;
    const homeGoals = hp === ha ? 2 : 0;
    const awayGoals = ap === aa ? 2 : 0;
    const diffAndWinner =
      resultCorrect && predDiff === actualDiff ? 1 : 0;
    const total = result + homeGoals + awayGoals + diffAndWinner;
    return { result, homeGoals, awayGoals, diffAndWinner, advance: 0, total };
  }

  // Knockout: wrong result at FT/ET → 0 for everything
  if (!resultCorrect) {
    return { ...ZERO };
  }

  const result = 10;
  const homeGoals = hp === ha ? 4 : 0;
  const awayGoals = ap === aa ? 4 : 0;
  const diffAndWinner = predDiff === actualDiff ? 2 : 0;

  let advance = 0;
  if (predResult !== "draw") {
    // Predicted a clear winner and got the result right → predicted winner = advancing team
    advance = 5;
  } else {
    // Both predicted and actual are draws; advancing team determined by penalty winner
    const actualAdvancer =
      actual.advancing_team_id ?? actual.penalty_winner_team_id ?? null;
    if (
      prediction.penalty_winner_team_id &&
      actualAdvancer &&
      prediction.penalty_winner_team_id === actualAdvancer
    ) {
      advance = 5;
    }
  }

  const total = result + homeGoals + awayGoals + diffAndWinner + advance;
  return { result, homeGoals, awayGoals, diffAndWinner, advance, total };
}

/**
 * Scores a podio (bonus) prediction against the final tournament standings.
 * Each slot is evaluated independently. Max 90 pts (50 + 25 + 15).
 */
export function scorePodio(
  prediction: PodioPrediction | null | undefined,
  actual: PodioActual | null | undefined
): number {
  if (!prediction || !actual) return 0;
  let pts = 0;
  if (
    prediction.champion_team_id &&
    prediction.champion_team_id === actual.champion_team_id
  )
    pts += 50;
  if (
    prediction.runner_up_team_id &&
    prediction.runner_up_team_id === actual.runner_up_team_id
  )
    pts += 25;
  if (
    prediction.third_place_team_id &&
    prediction.third_place_team_id === actual.third_place_team_id
  )
    pts += 15;
  return pts;
}

/**
 * Builds a ranked leaderboard from scored predictions.
 *
 * Ranking: total points (desc) → matches hit (desc) → zero matches (asc).
 * Unsubmitted predictions on finished matches count as zero-matches.
 *
 * @param users          All participating users.
 * @param finishedMatchIds IDs of matches that have been fully scored.
 * @param predictions    All scored predictions (only finished matches matter).
 */
export function computeLeaderboard(
  users: LeaderboardUser[],
  finishedMatchIds: string[],
  predictions: Array<{
    userId: string;
    matchId: string;
    pointsAwarded: number | null;
  }>
): LeaderboardRow[] {
  const finishedSet = new Set(finishedMatchIds);

  // Map "userId:matchId" → points for quick lookup
  const predMap = new Map<string, number>();
  for (const p of predictions) {
    if (finishedSet.has(p.matchId)) {
      predMap.set(`${p.userId}:${p.matchId}`, p.pointsAwarded ?? 0);
    }
  }

  type UserAgg = { total: number; hit: number; zero: number };
  const agg = new Map<string, UserAgg>();

  for (const user of users) {
    let total = 0;
    let hit = 0;
    let zero = 0;
    for (const matchId of finishedMatchIds) {
      const pts = predMap.get(`${user.id}:${matchId}`) ?? 0;
      total += pts;
      if (pts > 0) hit++;
      else zero++;
    }
    agg.set(user.id, { total, hit, zero });
  }

  const sorted = users.slice().sort((a, b) => {
    const sa = agg.get(a.id) ?? { total: 0, hit: 0, zero: 0 };
    const sb = agg.get(b.id) ?? { total: 0, hit: 0, zero: 0 };
    if (sb.total !== sa.total) return sb.total - sa.total;
    if (sb.hit !== sa.hit) return sb.hit - sa.hit;
    return sa.zero - sb.zero;
  });

  const leaderPoints =
    sorted.length > 0
      ? (agg.get(sorted[0]!.id) ?? { total: 0 }).total
      : 0;

  const rows: LeaderboardRow[] = [];
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    const user = sorted[i]!;
    const entry = agg.get(user.id) ?? { total: 0, hit: 0, zero: 0 };

    if (i > 0) {
      const prev = sorted[i - 1]!;
      const prevEntry = agg.get(prev.id) ?? { total: 0, hit: 0, zero: 0 };
      const tied =
        entry.total === prevEntry.total &&
        entry.hit === prevEntry.hit &&
        entry.zero === prevEntry.zero;
      if (!tied) currentRank = i + 1;
    }

    rows.push({
      rank: currentRank,
      userId: user.id,
      displayName: user.displayName,
      totalPoints: entry.total,
      matchesHit: entry.hit,
      zeroMatches: entry.zero,
      deltaFromLeader: entry.total - leaderPoints,
    });
  }

  return rows;
}
