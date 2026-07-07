import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { SimilarityHeatmap } from "@/components/progress/similarity-heatmap";
import { RoundSection } from "@/components/profile/round-section";
import { ProfileTabs } from "@/components/profile/profile-tabs";

interface Props {
  params: Promise<{ locale: string; userId: string }>;
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

export default async function ProfilePage({ params }: Props) {
  const { locale, userId } = await params;
  const t = await getTranslations("profile");
  const tRounds = await getTranslations("rounds");
  const tPred = await getTranslations("predictions");
  const tScoreboard = await getTranslations("scoreboard");
  const tProgress = await getTranslations("progress");
  const supabase = await createClient();
  const now = new Date();

  // All players — powers the switcher and is the rank denominator.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
  }));

  const profile = users.find((u) => u.id === userId);
  if (!profile) notFound();

  // All non-podio rounds
  const { data: roundsData } = await supabase
    .from("rounds")
    .select("id, stage, name_key, order_index, lock_time")
    .neq("stage", "podio")
    .order("order_index", { ascending: true });

  const rounds = roundsData ?? [];

  // Classify rounds
  const unlockedRounds = rounds.filter((r) => new Date(r.lock_time) > now);
  const currentRoundId =
    unlockedRounds.length > 0 ? unlockedRounds[0]!.id : null;

  const lockedRounds = rounds.filter((r) => new Date(r.lock_time) <= now);
  // The freshest results land here — this round starts expanded.
  const lastLockedRoundId =
    lockedRounds.length > 0 ? lockedRounds[lockedRounds.length - 1]!.id : null;

  // All matches with teams and stage (stage decides max points for "hits").
  const { data: matchesData } = await supabase
    .from("matches")
    .select(
      `id, round_id, kickoff_at, status, home_score, away_score,
       rounds ( stage ),
       home_team:home_team_id ( id, code, name_en, name_es, name_ko ),
       away_team:away_team_id ( id, code, name_en, name_es, name_ko )`
    )
    .order("kickoff_at", { ascending: true });

  const allMatches = matchesData ?? [];

  // ── Predictions tab data ──────────────────────────────────────────────────
  // The target user's predictions for locked rounds (RLS allows seeing others'
  // predictions after lock).
  const lockedMatchIds = allMatches
    .filter((m) =>
      lockedRounds.some((r) => r.id === m.round_id)
    )
    .map((m) => m.id);

  const { data: predsData } = lockedMatchIds.length
    ? await supabase
        .from("predictions")
        .select(
          "match_id, home_score_pred, away_score_pred, points_awarded"
        )
        .eq("user_id", userId)
        .in("match_id", lockedMatchIds)
    : { data: [] };

  const predMap = new Map(
    (predsData ?? []).map((p) => [p.match_id, p])
  );

  // Podio round
  const { data: podioRound } = await supabase
    .from("rounds")
    .select("lock_time")
    .eq("stage", "podio")
    .single();

  const podioLocked = podioRound
    ? new Date(podioRound.lock_time) <= now
    : false;

  // Podio prediction (RLS: own always visible; others only after lock)
  const { data: podioPred } = await supabase
    .from("podio_predictions")
    .select(
      `points_awarded,
       champion:teams!champion_team_id ( code, name_en, name_es, name_ko ),
       runner_up:teams!runner_up_team_id ( code, name_en, name_es, name_ko ),
       third_place:teams!third_place_team_id ( code, name_en, name_es, name_ko )`
    )
    .eq("user_id", userId)
    .maybeSingle();

  const matchPoints = (predsData ?? []).reduce(
    (sum, p) => sum + (p.points_awarded ?? 0),
    0
  );
  const podioPoints = podioPred?.points_awarded ?? 0;
  const totalPoints = matchPoints + (podioLocked ? podioPoints : 0);

  // ── Progress tab data ─────────────────────────────────────────────────────
  // Finished matches in chronological order drive the ranking computations.
  const finishedMatches = allMatches.filter((m) => m.status === "finished");
  const orderedMatchIds = finishedMatches.map((m) => m.id);

  const orderedMatches: FinishedMatch[] = finishedMatches.map((m) => {
    const round = one(m.rounds);
    return {
      id: m.id,
      stage: round?.stage === "group" ? "group" : "knockout",
    };
  });

  // All predictions for finished matches, across every user — needed because
  // rank is inherently relative. Free tier caps a single request at 1000 rows,
  // so page through with .range() until a short page returns.
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

  // The target user's predicted scores (for the chart tooltip).
  const userPredMap = new Map(
    allPreds.filter((p) => p.user_id === userId).map((p) => [p.match_id, p])
  );

  const playerStats = computePlayerRankStats(
    users,
    orderedMatches,
    pointsInput
  );
  const selectedStats = playerStats.find((s) => s.userId === userId) ?? null;

  // Average goals predicted per match.
  let goalSum = 0;
  let goalCount = 0;
  for (const p of allPreds) {
    if (p.user_id === userId) {
      goalSum += p.home_score_pred + p.away_score_pred;
      goalCount += 1;
    }
  }
  const avgGoals = goalCount > 0 ? goalSum / goalCount : null;

  const currentRank =
    orderedMatches.length && selectedStats ? selectedStats.currentRank : null;

  // ── Pick-similarity heatmap ───────────────────────────────────────────────
  // Compares the player's picks against their leaderboard neighbours over the
  // next few upcoming matches. Other players' picks are only visible once the
  // round locks (RLS), so this is gated on lock_time having passed.
  const HEATMAP_PLAYERS = 8;
  const HEATMAP_MATCHES = 3;
  const nowIso = now.toISOString();

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

  const firstUpcoming = upcoming?.[0];
  const upcomingRoundId = firstUpcoming?.round_id ?? null;
  const roundMatches = (upcoming ?? [])
    .filter((m) => m.round_id === upcomingRoundId)
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

  const ranked: RankedPlayer[] = playerStats.map((s) => ({
    userId: s.userId,
    displayName: s.displayName,
    rank: s.currentRank,
  }));
  const neighbours = selectNeighbours(ranked, userId, HEATMAP_PLAYERS).map(
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
    userId
  );

  const matchById = new Map(finishedMatches.map((m) => [m.id, m]));
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

  // ── Render ────────────────────────────────────────────────────────────────
  const initial = (profile.displayName || "?").trim().charAt(0).toUpperCase();

  const statChips: Array<{ label: string; value: string }> = [
    {
      label: tProgress("colBestRank"),
      value: selectedStats?.bestRank != null ? `#${selectedStats.bestRank}` : "—",
    },
    {
      label: tProgress("colWorstRank"),
      value:
        selectedStats?.worstRank != null ? `#${selectedStats.worstRank}` : "—",
    },
    { label: tProgress("colHits"), value: String(selectedStats?.hits ?? 0) },
    { label: tProgress("colZeros"), value: String(selectedStats?.zeros ?? 0) },
    {
      label: tProgress("colAvgGoals"),
      value: avgGoals != null ? avgGoals.toFixed(1) : "—",
    },
  ];

  const podiumRows = podioPred
    ? ([
        { label: t("champion"), team: one(podioPred.champion), top: true },
        { label: t("runnerUp"), team: one(podioPred.runner_up), top: false },
        { label: t("thirdPlace"), team: one(podioPred.third_place), top: false },
      ] as const)
    : null;

  const predictionsTab = (
    <>
      {/* Bonus Podium */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="font-semibold">{t("podiumSection")}</h2>
        {!podioLocked ? (
          <p className="text-sm text-muted-foreground">{t("podiumOpen")}</p>
        ) : podiumRows ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {podiumRows.map(({ label, team, top }) => (
                <div
                  key={label}
                  className={
                    top
                      ? "rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
                      : "rounded-lg border px-3 py-2"
                  }
                >
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium">{teamName(team ?? null, locale)}</p>
                </div>
              ))}
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">{t("podiumTotal")}: </span>
              <span className="font-bold text-primary">
                {podioPred?.points_awarded ?? "—"} {tPred("pts")}
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("podiumNone")}</p>
        )}
      </section>

      {/* All rounds */}
      {rounds.map((round) => {
        const isLocked = new Date(round.lock_time) <= now;
        const isCurrent = round.id === currentRoundId;
        const roundKey = round.name_key.replace(
          "rounds.",
          ""
        ) as Parameters<typeof tRounds>[0];

        const roundMatchList = allMatches.filter(
          (m) => m.round_id === round.id
        );

        const roundPoints = roundMatchList.reduce((sum, m) => {
          const p = predMap.get(m.id);
          return sum + (p?.points_awarded ?? 0);
        }, 0);

        const header = (
          <>
            <h2 className="font-semibold">{tRounds(roundKey)}</h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full border"
              style={
                isLocked
                  ? { color: "#6b7280", borderColor: "#d1d5db" }
                  : isCurrent
                  ? { color: "#16a34a", borderColor: "#16a34a" }
                  : { color: "#9ca3af", borderColor: "#e5e7eb" }
              }
            >
              {isLocked
                ? tPred("locked")
                : isCurrent
                ? t("currentRoundBadge")
                : t("upcomingBadge")}
            </span>
            {isLocked && (
              <span className="ml-auto text-sm font-bold text-primary">
                {roundPoints} {tPred("pts")}
              </span>
            )}
          </>
        );

        return (
          <RoundSection
            key={round.id}
            header={header}
            collapsible={isLocked}
            defaultCollapsed={
              isLocked ? round.id !== lastLockedRoundId : undefined
            }
          >
            {isLocked ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                        {tPred("result")}
                      </th>
                      <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">
                        {tPred("yourPrediction")}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                        {tPred("pts")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {roundMatchList.map((match) => {
                      const ht = one(match.home_team);
                      const at = one(match.away_team);
                      const pred = predMap.get(match.id);

                      return (
                        <tr key={match.id} className="hover:bg-muted/20">
                          <td className="px-2 py-2">
                            <span className="font-medium">
                              {teamName(ht ?? null, locale)}
                            </span>
                            {match.home_score != null &&
                            match.away_score != null ? (
                              <span className="mx-1 text-muted-foreground">
                                {match.home_score}–{match.away_score}
                              </span>
                            ) : (
                              <span className="mx-1 text-muted-foreground">
                                vs
                              </span>
                            )}
                            <span className="font-medium">
                              {teamName(at ?? null, locale)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            {pred ? (
                              <span>
                                {pred.home_score_pred}–{pred.away_score_pred}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {pred ? (
                              <span
                                className={
                                  (pred.points_awarded ?? 0) > 0
                                    ? "font-bold text-green-600"
                                    : "text-muted-foreground"
                                }
                              >
                                {pred.points_awarded ?? "—"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground pl-1">
                {isCurrent ? t("currentRoundNote") : t("upcomingNote")}
              </p>
            )}
          </RoundSection>
        );
      })}
    </>
  );

  const progressTab = (
    <>
      {points.length === 0 ? (
        <p className="text-muted-foreground">{tProgress("noData")}</p>
      ) : (
        <div className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">{tProgress("rankAxis")}</h2>
          <RankChart
            points={points}
            labels={{
              match: tProgress("match"),
              result: tProgress("result"),
              prediction: tProgress("prediction"),
              rank: tProgress("rank"),
              points: tProgress("points"),
              noPrediction: tProgress("noPrediction"),
              matchAxis: tProgress("matchAxis"),
              rankAxis: tProgress("rankAxis"),
            }}
          />
          <p className="text-center text-xs text-muted-foreground">
            {tProgress("hint")}
          </p>
        </div>
      )}

      {showHeatmap && (
        <SimilarityHeatmap
          data={similarity}
          selectedId={userId}
          labels={{
            heading: tProgress("simHeading"),
            subtitle: tProgress("simSubtitle", { count: simMatches.length }),
            legendLow: tProgress("simLegendLow"),
            legendHigh: tProgress("simLegendHigh"),
            noData: tProgress("simNoData"),
            blank: tProgress("simBlank"),
            cellTitle: tProgress.raw("simCellTitle"),
          }}
        />
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Back link + player switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/${locale}/scoreboard`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {tScoreboard("backToScoreboard")}
        </Link>
        <UserSelect
          users={users}
          selectedId={userId}
          label={tProgress("selectUser")}
          basePath={`/${locale}/profile`}
        />
      </div>

      {/* Hero header */}
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
          {initial}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{profile.displayName}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-primary">
              {totalPoints} {tPred("pts")}
            </span>
            {currentRank != null && (
              <span>
                {" "}
                · #{currentRank} / {users.length}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {statChips.map((chip) => (
          <div
            key={chip.label}
            className="rounded-lg border bg-muted/30 px-3 py-2"
          >
            <p className="text-xs text-muted-foreground">{chip.label}</p>
            <p className="text-lg font-semibold">{chip.value}</p>
          </div>
        ))}
      </div>

      <ProfileTabs
        tabs={[
          {
            id: "predictions",
            label: t("tabPredictions"),
            content: predictionsTab,
          },
          { id: "progress", label: t("tabProgress"), content: progressTab },
        ]}
      />
    </div>
  );
}
