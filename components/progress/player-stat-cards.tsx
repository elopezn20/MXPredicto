export interface PlayerStatCardsData {
  bestRank: number | null;
  worstRank: number | null;
  currentRank: number | null;
  totalPlayers: number;
  totalPoints: number;
  hits: number;
  zeros: number;
  avgGoals: number | null;
  team: string | null;
}

interface Labels {
  currentRank: string;
  bestRank: string;
  worstRank: string;
  totalPoints: string;
  hits: string;
  zeros: string;
  avgGoals: string;
  team: string;
}

interface Props {
  data: PlayerStatCardsData;
  labels: Labels;
}

export function PlayerStatCards({ data, labels }: Props) {
  const rank = (n: number | null) => (n != null ? `#${n}` : "—");

  const cards: Array<{ label: string; value: string; highlight?: boolean }> = [
    {
      label: labels.currentRank,
      value:
        data.currentRank != null
          ? `#${data.currentRank} / ${data.totalPlayers}`
          : "—",
      highlight: true,
    },
    { label: labels.bestRank, value: rank(data.bestRank) },
    { label: labels.worstRank, value: rank(data.worstRank) },
    { label: labels.totalPoints, value: String(data.totalPoints), highlight: true },
    { label: labels.hits, value: String(data.hits) },
    { label: labels.zeros, value: String(data.zeros) },
    {
      label: labels.avgGoals,
      value: data.avgGoals != null ? data.avgGoals.toFixed(1) : "—",
    },
    { label: labels.team, value: data.team ?? "—" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p
            className={
              c.highlight
                ? "text-xl font-bold text-primary"
                : "text-xl font-semibold"
            }
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
