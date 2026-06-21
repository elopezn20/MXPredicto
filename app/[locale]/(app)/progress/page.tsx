import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { computeRankTrajectory } from "@/lib/scoring/progress";
import { UserSelect } from "@/components/progress/user-select";
import { RankChart, type ChartPoint } from "@/components/progress/rank-chart";

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

  // Finished matches in chronological order, with team names.
  const { data: matchesData } = await supabase
    .from("matches")
    .select(
      `id, kickoff_at, home_score, away_score,
       home_team:home_team_id ( name_en, name_es, name_ko ),
       away_team:away_team_id ( name_en, name_es, name_ko )`
    )
    .eq("status", "finished")
    .order("kickoff_at", { ascending: true });

  const matches = matchesData ?? [];
  const orderedMatchIds = matches.map((m) => m.id);

  // All scored predictions for finished matches, across every user.
  // Free tier caps a single request at 1000 rows; 62 users × 104 matches can
  // exceed that, so page through with .range() until a short page returns.
  const allPreds: Array<{
    user_id: string;
    match_id: string;
    points_awarded: number | null;
  }> = [];

  if (orderedMatchIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page } = await supabase
        .from("predictions")
        .select("user_id, match_id, points_awarded")
        .in("match_id", orderedMatchIds)
        .range(from, from + PAGE_SIZE - 1);

      const rows = page ?? [];
      allPreds.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }

  // The selected user's predicted scores (for the tooltip). ≤104 rows.
  const { data: userPreds } = selectedId && orderedMatchIds.length
    ? await supabase
        .from("predictions")
        .select("match_id, home_score_pred, away_score_pred")
        .eq("user_id", selectedId)
        .in("match_id", orderedMatchIds)
    : { data: [] };

  const userPredMap = new Map(
    (userPreds ?? []).map((p) => [p.match_id, p])
  );

  const trajectory = computeRankTrajectory(
    users,
    orderedMatchIds,
    allPreds.map((p) => ({
      userId: p.user_id,
      matchId: p.match_id,
      pointsAwarded: p.points_awarded,
    })),
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

  const last = points[points.length - 1];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2855] dark:text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <UserSelect users={users} selectedId={selectedId} label={t("selectUser")} />

      {points.length === 0 ? (
        <p className="text-muted-foreground">{t("noData")}</p>
      ) : (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">{t("currentRank")}: </span>
              <span className="font-bold text-primary">
                #{last?.rank} / {last?.totalPlayers}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">{t("totalPoints")}: </span>
              <span className="font-bold text-primary">
                {last?.cumulativePoints}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">{t("matchesPlayed")}: </span>
              <span className="font-medium">{points.length}</span>
            </span>
          </div>

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
