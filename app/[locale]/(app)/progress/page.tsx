import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  computeRankTrajectory,
  computePlayerRankStats,
  type FinishedMatch,
} from "@/lib/scoring/progress";
import {
  computePickSimilarity,
  selectNeighbours,
  type SimMatch,
  type RankedPlayer,
} from "@/lib/scoring/pick-similarity";
import { UserSelect } from "@/components/progress/user-select";
import { RankChart, type ChartPoint } from "@/components/progress/rank-chart";
import { PlayerStatCards } from "@/components/progress/player-stat-cards";
import { SimilarityHeatmap } from "@/components/progress/similarity-heatmap";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ user?: string }>;
}

type TeamRow = { name_en: string; name_es: string; name_ko: string } | null;

function teamName(team: TeamRow, locale: string) {
  if (!team) return "TBD";
  if (locale === "ko") return team.name_ko;
  if (locale === "en") return team.name_en;
  return team.name_es;
}

function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

const PAGE_SIZE = 1000;

export default async function ProgressPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { user: userParam } = await searchParams;
  const t = await getTranslations("progress");
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // All players (62 rows) — used both for the selector and rank denominator.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
  }));

  // Resolve the selected user: ?user=, else the signed-in user, else the first.
  const validId = (id: string | undefined) =>
    id && users.some((u) => u.id === id) ? id : undefined;
  const selectedId =
    validId(userParam) ?? validId(authUser?.id) ?? users[0]?.id ?? "";

  // Finished matches in chronological order, with team names and stage.
  // Stage decides a match's maximum points (10 group / 25 knockout), which the
  // ranking uses to detect "hits".
  const { data: matchesData } = await supabase
    .from("matches")
    .select(
      `id, kickoff_at, home_score, away_score,
       rounds ( stage ),
       home_team:home_team_id ( name_en, name_es, name_ko ),
       away_team:away_team_id ( name_en, name_es, name_ko )`
    )
    .eq("status", "finished")
    .order("kickoff_at", { ascending: true });

  const matches = matchesData ?? [];
  const orderedMatchIds = matches.map((m) => m.id);

  // Map each match to its stage for the ranking functions.
  const orderedMatches: FinishedMatch[] = matches.map((m) => {
    const round = Array.isArray(m.rounds) ? m.rounds[0] : m.rounds;
    return {
      id: m.id,
      stage: round?.stage === "group" ? "group" : "knockout",
    };
  });

  // All predictions for finished matches, across every user. Carries both the
  // scored points (for ranking) and the predicted goals (for the table + tooltip).
  // Free tier caps a single request at 1000 rows; 62 users × 104 matches can
  // exceed that, so page through with .range() until a short page returns.
  const allPreds: Array<{
    user_id: string;
    match_id: string;
    points_awarded: number | null;
    home_score_pred: number;
    away_score_pred: number;
  }> = [];

  if (orderedMatchIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("predictions")
        .select(
          "user_id, match_id, points_awarded, home_score_pred, away_score_pred"
        )
        .in("match_id", orderedMatchIds)
        .range(from, from + PAGE_SIZE - 1);

      const rows = page ?? [];
      allPreds.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }

  const pointsInput = allPreds.map((p) => ({
    userId: p.user_id,
    matchId: p.match_id,
    pointsAwarded: p.points_awarded,
  }));

  // The selected user's predicted scores (for the chart tooltip).
  const userPredMap = new Map(
    allPreds
      .filter((p) => p.user_id === selectedId)
      .map((p) => [p.match_id, p])
  );

  // Season stats (best/worst rank, hits, zeros) computed across all players —
  // best/worst rank is inherently relative — then we read off the selected one.
  const playerStats = computePlayerRankStats(
    users,
    orderedMatches,
    pointsInput
  );
  const selectedStats = playerStats.find((s) => s.userId === selectedId) ?? null;

  // The selected player's average goals predicted per match.
  let goalSum = 0;
  let goalCount = 0;
  for (const p of allPreds) {
    if (p.user_id === selectedId) {
      goalSum += p.home_score_pred + p.away_score_pred;
      goalCount += 1;
    }
  }
  const selectedAvgGoals = goalCount > 0 ? goalSum / goalCount : null;

  const selectedName =
    users.find((u) => u.id === selectedId)?.displayName ?? "";

  // ── Pick-similarity heatmap ───────────────────────────────────────────────
  // Compares the selected player's picks against their leaderboard neighbours
  // over the next few upcoming matches in the current round. Other players'
  // picks are only visible once the round locks (RLS), so this is gated on
  // lock_time having passed — mirroring the scoreboard's next-match panel.
  const HEATMAP_PLAYERS = 8; // selected player + nearest neighbours
  const HEATMAP_MATCHES = 3; // "upcoming 3 matches of that round"
  const nowIso = new Date().toISOString();

  const { data: upcoming } = await supabase
    .from("matches")
    .select("id, round_id, kickoff_at, rounds ( lock_time, stage )")
    .neq("status", "finished")
    .order("kickoff_at", { ascending: true })
    .limit(30);

  const roundOf = (m: { rounds: unknown }) =>
    (Array.isArray(m.rounds) ? m.rounds[0] : m.rounds) as
      | { lock_time: string; stage: string }
      | null;

  // The current round = the round of the earliest upcoming match; take that
  // round's first few upcoming matches.
  const firstUpcoming = upcoming?.[0];
  const currentRoundId = firstUpcoming?.round_id ?? null;
  const roundMatches = (upcoming ?? [])
    .filter((m) => m.round_id === currentRoundId)
    .slice(0, HEATMAP_MATCHES);
  const lockTime = firstUpcoming ? roundOf(firstUpcoming)?.lock_time ?? null : null;
  const heatmapLocked = !!lockTime && lockTime <= nowIso;

  const simMatchIds = roundMatches.map((m) => m.id);
  const { data: simPredsData } =
    heatmapLocked && simMatchIds.length > 0
      ? await supabase
          .from("predictions")
          .select("user_id, match_id, home_score_pred, away_score_pred")
          .in("match_id", simMatchIds)
      : { data: [] };

  const simMatches: SimMatch[] = roundMatches.map((m) => ({
    id: m.id,
    stage: roundOf(m)?.stage === "group" ? "group" : "knockout",
  }));

  // Selected player + neighbours, ranked by current standing.
  const ranked: RankedPlayer[] = playerStats.map((s) => ({
    userId: s.userId,
    displayName: s.displayName,
    rank: s.currentRank,
  }));
  const neighbours = selectNeighbours(ranked, selectedId, HEATMAP_PLAYERS).map(
    (p) => ({ userId: p.userId, displayName: p.displayName })
  );

  const similarity = computePickSimilarity(
    neighbours,
    simMatches,
    (simPredsData ?? []).map((p) => ({
      userId: p.user_id,
      matchId: p.match_id,
      homeScore: p.home_score_pred,
      awayScore: p.away_score_pred,
    }))
  );

  const showHeatmap =
    heatmapLocked && simMatches.length > 0 && neighbours.length >= 2;

  const trajectory = computeRankTrajectory(
    users,
    orderedMatches,
    pointsInput,
    selectedId
  );

  // Merge trajectory + match info + the selected user's prediction.
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const points: ChartPoint[] = trajectory.map((rp) => {
    const m = matchById.get(rp.matchId)!;
    const pred = userPredMap.get(rp.matchId);
    return {
      index: rp.index,
      matchId: rp.matchId,
      homeName: teamName(one(m.home_team), locale),
      awayName: teamName(one(m.away_team), locale),
      homeScore: m.home_score,
      awayScore: m.away_score,
      predHome: pred?.home_score_pred ?? null,
      predAway: pred?.away_score_pred ?? null,
      pointsThisMatch: rp.pointsThisMatch,
      cumulativePoints: rp.cumulativePoints,
      rank: rp.rank,
      totalPlayers: rp.totalPlayers,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2855] dark:text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 1. Choose a player */}
      <UserSelect users={users} selectedId={selectedId} label={t("selectUser")} />

      {selectedStats && (
        <div className="space-y-4">
          {/* 2. That player's stats */}
          <h2 className="font-semibold">{selectedName}</h2>
          <PlayerStatCards
            data={{
              currentRank: orderedMatches.length ? selectedStats.currentRank : null,
              totalPlayers: users.length,
              bestRank: selectedStats.bestRank,
              worstRank: selectedStats.worstRank,
              totalPoints: selectedStats.totalPoints,
              hits: selectedStats.hits,
              zeros: selectedStats.zeros,
              avgGoals: selectedAvgGoals,
              team: null, // intentionally blank for now
            }}
            labels={{
              currentRank: t("currentRank"),
              bestRank: t("colBestRank"),
              worstRank: t("colWorstRank"),
              totalPoints: t("totalPoints"),
              hits: t("colHits"),
              zeros: t("colZeros"),
              avgGoals: t("colAvgGoals"),
              team: t("colTeam"),
            }}
          />

          {/* 2b. Pick-similarity vs leaderboard neighbours */}
          {showHeatmap && (
            <SimilarityHeatmap
              data={similarity}
              selectedId={selectedId}
              labels={{
                heading: t("simHeading"),
                subtitle: t("simSubtitle", { count: simMatches.length }),
                legendLow: t("simLegendLow"),
                legendHigh: t("simLegendHigh"),
                noData: t("simNoData"),
                blank: t("simBlank"),
                cellTitle: t.raw("simCellTitle"),
              }}
            />
          )}
        </div>
      )}

      {/* 3. Ranking over time */}
      {points.length === 0 ? (
        <p className="text-muted-foreground">{t("noData")}</p>
      ) : (
        <div className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">{t("rankAxis")}</h2>
          <RankChart
            points={points}
            labels={{
              match: t("match"),
              result: t("result"),
              prediction: t("prediction"),
              rank: t("rank"),
              points: t("points"),
              noPrediction: t("noPrediction"),
              matchAxis: t("matchAxis"),
              rankAxis: t("rankAxis"),
            }}
          />
          <p className="text-center text-xs text-muted-foreground">
            {t("hint")}
          </p>
        </div>
      )}
    </div>
  );
}
