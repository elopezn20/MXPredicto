import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeLeaderboard } from "@/lib/scoring/scoring";
import { computeNextMatchStats } from "@/lib/scoring/next-match-stats";
import { NextMatchStatsPanel } from "@/components/scoreboard/next-match-stats";
import { KickoffTime } from "@/components/scoreboard/kickoff-time";
import { ExportPdfButton } from "@/components/scoreboard/export-pdf-button";
import { cn } from "@/lib/utils";

function teamName(
  team: { code: string; name_en: string; name_es: string; name_ko: string } | null,
  locale: string
): string {
  if (!team) return "—";
  if (locale === "ko") return team.name_ko;
  if (locale === "en") return team.name_en;
  return team.name_es;
}

const PRIZES_CLP = [
  868_000, 248_000, 124_000
] as const;
const POOL_TOTAL_CLP = PRIZES_CLP.reduce((sum, n) => sum + n, 0);

function formatCLP(locale: string, amount: number): string {
  const tag = locale === "es" ? "es-CL" : locale === "ko" ? "ko-KR" : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function ScoreboardPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("scoreboard");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // All profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");

  // Finished matches with stage (group/knockout) for perfect-match hit detection
  const { data: finishedMatches } = await supabase
    .from("matches")
    .select("id, rounds(stage)")
    .eq("status", "finished");

  const finishedWithStage = (finishedMatches ?? []).flatMap((m) => {
    const roundData = Array.isArray(m.rounds) ? m.rounds[0] : m.rounds;
    const stage: "group" | "knockout" =
      roundData?.stage === "group" ? "group" : "knockout";
    return [{ id: m.id, stage }];
  });
  const finishedIds = finishedWithStage.map((m) => m.id);

  // All predictions for finished matches (RLS allows seeing others' in locked rounds)
  const { data: preds } = finishedIds.length
    ? await supabase
        .from("predictions")
        .select("user_id, match_id, points_awarded")
        .in("match_id", finishedIds)
    : { data: [] };

  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
  }));

  const predictions = (preds ?? []).map((p) => ({
    userId: p.user_id,
    matchId: p.match_id,
    pointsAwarded: p.points_awarded,
  }));

  const rows = computeLeaderboard(users, finishedWithStage, predictions);

  // ── Next match panel + per-player "next pick" column ──────────────────────────
  // The next not-yet-finished match, earliest first. Other players' predictions
  // for it are only visible (per RLS) once its round has locked, so we only
  // surface aggregate stats / picks when lock_time has passed.
  const nowIso = new Date().toISOString();
  const { data: nextMatch } = await supabase
    .from("matches")
    .select(
      `id, kickoff_at, status,
       rounds ( lock_time ),
       home_team:home_team_id ( code, name_en, name_es, name_ko ),
       away_team:away_team_id ( code, name_en, name_es, name_ko )`
    )
    .neq("status", "finished")
    .order("kickoff_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextRound = nextMatch
    ? Array.isArray(nextMatch.rounds)
      ? nextMatch.rounds[0]
      : nextMatch.rounds
    : null;
  const nextMatchLocked =
    !!nextRound?.lock_time && nextRound.lock_time <= nowIso;

  // Picks are only fetched/shown once the round locks (RLS would hide others
  // anyway; this also keeps the column empty before lock).
  const { data: nextPreds } = nextMatch && nextMatchLocked
    ? await supabase
        .from("predictions")
        .select("user_id, home_score_pred, away_score_pred")
        .eq("match_id", nextMatch.id)
    : { data: [] };

  const nextStats = computeNextMatchStats(
    (nextPreds ?? []).map((p) => ({
      userId: p.user_id,
      homeScore: p.home_score_pred,
      awayScore: p.away_score_pred,
    }))
  );

  const pickByUser = new Map<string, string>(
    (nextPreds ?? []).map((p) => [
      p.user_id,
      `${p.home_score_pred}–${p.away_score_pred}`,
    ])
  );

  const nextHomeTeam = nextMatch
    ? Array.isArray(nextMatch.home_team)
      ? nextMatch.home_team[0]
      : nextMatch.home_team
    : null;
  const nextAwayTeam = nextMatch
    ? Array.isArray(nextMatch.away_team)
      ? nextMatch.away_team[0]
      : nextMatch.away_team
    : null;

  const nextHomeName = teamName(nextHomeTeam ?? null, locale);
  const nextAwayName = teamName(nextAwayTeam ?? null, locale);

  // Server-rendered fallback in the pool's home timezone (Chile). The
  // <KickoffTime> client component re-formats this in the viewer's local
  // timezone after mount, matching how the prediction match cards display
  // kickoff times. Without a fixed timeZone here the server would format in
  // its own tz (UTC), which is what caused the scoreboard/predictions mismatch.
  const kickoffFallback = nextMatch
    ? new Intl.DateTimeFormat(
        locale === "es" ? "es-CL" : locale === "ko" ? "ko-KR" : "en-US",
        {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Santiago",
        }
      ).format(new Date(nextMatch.kickoff_at))
    : "";

  // Show the column header only when there's a next match to predict.
  const showNextPick = !!nextMatch;
  const nextMatchCodes =
    nextHomeTeam?.code && nextAwayTeam?.code
      ? `${nextHomeTeam.code}–${nextAwayTeam.code}`
      : null;

  // Print-only generation timestamp.
  const generatedLabel = new Intl.DateTimeFormat(
    locale === "es" ? "es-CL" : locale === "ko" ? "ko-KR" : "en-US",
    { dateStyle: "long", timeStyle: "short" }
  ).format(new Date());

  // Tied ranks split the combined pot for the positions they occupy.
  // E.g. three players tied at rank 1 share prizes for positions 1, 2 and 3.
  const prizeByRank = new Map<number, number>();
  for (let i = 0; i < rows.length; ) {
    const rank = rows[i]!.rank;
    let j = i;
    while (j < rows.length && rows[j]!.rank === rank) j++;
    const groupSize = j - i;
    let pot = 0;
    for (let k = 0; k < groupSize; k++) {
      pot += PRIZES_CLP[rank - 1 + k] ?? 0;
    }
    if (pot > 0) prizeByRank.set(rank, Math.round(pot / groupSize));
    i = j;
  }

  return (
    <div id="scoreboard-print" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">{t("title")}</h1>
        <ExportPdfButton label={t("exportPdf")} />
      </div>

      <p className="hidden text-sm text-muted-foreground print:block">
        {generatedLabel}
      </p>

      {nextMatch && (
        <div className="space-y-2">
          <h2 className="text-center text-base font-semibold text-muted-foreground">
            {t("nextMatch")}
          </h2>
          <NextMatchStatsPanel
            homeName={nextHomeName}
            awayName={nextAwayName}
            kickoff={
              <KickoffTime
                iso={nextMatch.kickoff_at}
                locale={locale}
                fallback={kickoffFallback}
              />
            }
            stats={nextStats}
            labels={{
              heading: t("nextMatch"),
              modeTitle: t("mode"),
              averageTitle: t("averageScore"),
              topPrefix: t("top"),
              winsWord: t("wins"),
              drawsWord: t("draws"),
              noPredictions: nextMatchLocked
                ? t("noPredictions")
                : t("picksLocked"),
            }}
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {t.rich("poolCaption", {
          amount: formatCLP(locale, POOL_TOTAL_CLP),
          link: (chunks) => (
            <Link
              href={`/${locale}/rules`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("noData")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {t("rank")}
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {t("player")}
                </th>
                {showNextPick && (
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                    <span>{t("nextPick")}</span>
                    {nextMatchCodes && (
                      <span className="block text-[11px] font-semibold tracking-wide text-foreground/70">
                        {nextMatchCodes}
                      </span>
                    )}
                  </th>
                )}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  {t("points")}
                </th>
                <th className="hidden px-3 py-2 text-right font-medium text-muted-foreground sm:table-cell">
                  {t("hits")}
                </th>
                <th className="hidden px-3 py-2 text-right font-medium text-muted-foreground sm:table-cell">
                  {t("zeros")}
                </th>
                <th className="hidden px-3 py-2 text-right font-medium text-muted-foreground md:table-cell">
                  {t("gap")}
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  {t("prize")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const isMe = row.userId === user?.id;
                const isFirst = row.rank === 1;
                const prizeAmount = prizeByRank.get(row.rank);
                const prize =
                  prizeAmount !== undefined ? formatCLP(locale, prizeAmount) : "—";
                return (
                  <tr
                    key={row.userId}
                    className={cn(
                      "transition-colors hover:bg-muted/30",
                      isFirst &&
                        "bg-highlight/15 ring-1 ring-inset ring-highlight/40 hover:bg-highlight/20",
                      isMe && !isFirst && "bg-highlight/10 font-semibold"
                    )}
                  >
                    <td
                      className={cn(
                        "px-3 text-muted-foreground",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      <span className={cn(isFirst && "text-3xl")}>
                        {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank}
                      </span>
                    </td>
                    <td className={cn("px-3", isFirst ? "py-4" : "py-2.5")}>
                      <Link
                        href={`/${locale}/profile/${row.userId}`}
                        className={cn(
                          "hover:underline",
                          isFirst && "text-lg font-bold text-foreground"
                        )}
                      >
                        {row.displayName}
                      </Link>
                      {isMe && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {t("you")}
                        </span>
                      )}
                    </td>
                    {showNextPick && (
                      <td
                        className={cn(
                          "px-3 text-center tabular-nums text-muted-foreground",
                          isFirst ? "py-4" : "py-2.5"
                        )}
                      >
                        {pickByUser.get(row.userId) ?? "—"}
                      </td>
                    )}
                    <td
                      className={cn(
                        "px-3 text-right font-bold text-primary",
                        isFirst ? "py-4 text-xl" : "py-2.5"
                      )}
                    >
                      {row.totalPoints}
                    </td>
                    <td
                      className={cn(
                        "hidden px-3 text-right text-muted-foreground sm:table-cell",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      {row.matchesHit}
                    </td>
                    <td
                      className={cn(
                        "hidden px-3 text-right text-muted-foreground sm:table-cell",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      {row.zeroMatches}
                    </td>
                    <td
                      className={cn(
                        "hidden px-3 text-right text-muted-foreground md:table-cell",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      {row.deltaFromLeader < 0
                        ? `${row.deltaFromLeader}`
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap",
                        isFirst ? "py-4" : "py-2.5",
                        prizeAmount !== undefined
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {prize}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
