import Link from "next/link";
import { cn } from "@/lib/utils";

export interface PlayerStatsRow {
  userId: string;
  displayName: string;
  bestRank: number | null;
  worstRank: number | null;
  hits: number;
  zeros: number;
  avgGoals: number | null;
  team: string | null;
}

interface Labels {
  player: string;
  bestRank: string;
  worstRank: string;
  hits: string;
  zeros: string;
  avgGoals: string;
  team: string;
}

interface Props {
  rows: PlayerStatsRow[];
  selectedId: string;
  locale: string;
  labels: Labels;
}

export function PlayerStatsTable({ rows, selectedId, locale, labels }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              {labels.player}
            </th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
              {labels.bestRank}
            </th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
              {labels.worstRank}
            </th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
              {labels.hits}
            </th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
              {labels.zeros}
            </th>
            <th className="hidden px-3 py-2 text-right font-medium text-muted-foreground sm:table-cell">
              {labels.avgGoals}
            </th>
            <th className="hidden px-3 py-2 text-left font-medium text-muted-foreground sm:table-cell">
              {labels.team}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const isSelected = row.userId === selectedId;
            return (
              <tr
                key={row.userId}
                className={cn(
                  "transition-colors hover:bg-muted/30",
                  isSelected && "bg-highlight/10 font-semibold"
                )}
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/${locale}/progress?user=${row.userId}`}
                    className="hover:underline"
                  >
                    {row.displayName}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {row.bestRank ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {row.worstRank ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">
                  {row.hits}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground">
                  {row.zeros}
                </td>
                <td className="hidden px-3 py-2.5 text-right text-muted-foreground sm:table-cell">
                  {row.avgGoals != null ? row.avgGoals.toFixed(1) : "—"}
                </td>
                <td className="hidden px-3 py-2.5 text-left text-muted-foreground sm:table-cell">
                  {row.team ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
