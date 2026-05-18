import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeLeaderboard } from "@/lib/scoring/scoring";
import { cn } from "@/lib/utils";

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

  // Finished match IDs
  const { data: finishedMatches } = await supabase
    .from("matches")
    .select("id")
    .eq("status", "finished");

  const finishedIds = (finishedMatches ?? []).map((m) => m.id);

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

  const rows = computeLeaderboard(users, finishedIds, predictions);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">{t("title")}</h1>

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
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const isMe = row.userId === user?.id;
                return (
                  <tr
                    key={row.userId}
                    className={cn(
                      "transition-colors hover:bg-muted/30",
                      isMe && "bg-highlight/10 font-semibold"
                    )}
                  >
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/${locale}/scoreboard/${row.userId}`}
                        className="hover:underline"
                      >
                        {row.displayName}
                      </Link>
                      {isMe && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {t("you")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-primary">
                      {row.totalPoints}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-muted-foreground sm:table-cell">
                      {row.matchesHit}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-muted-foreground sm:table-cell">
                      {row.zeroMatches}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-muted-foreground md:table-cell">
                      {row.deltaFromLeader < 0
                        ? `${row.deltaFromLeader}`
                        : "—"}
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
