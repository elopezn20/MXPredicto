import type {
  NextMatchStats,
  OutcomeBucket,
  Scoreline,
} from "@/lib/scoring/next-match-stats";

export interface NextMatchStatsLabels {
  heading: string; // "Next match"
  modeTitle: string; // "Mode (most predicted)"
  averageTitle: string; // "Average score"
  topPrefix: string; // "Top" → "Top {home} wins"
  winsWord: string; // "wins"
  drawsWord: string; // "Draws"
  noPredictions: string; // shown when nobody has predicted
}

interface Props {
  homeName: string;
  awayName: string;
  kickoffLabel: string;
  stats: NextMatchStats;
  labels: NextMatchStatsLabels;
}

type Tone = "home" | "draw" | "away";

const TONE: Record<
  Tone,
  { border: string; ring: string; text: string }
> = {
  home: {
    border: "border-green-300 dark:border-green-900",
    ring: "border-green-500/60",
    text: "text-green-700 dark:text-green-400",
  },
  draw: {
    border: "border-amber-300 dark:border-amber-900",
    ring: "border-amber-500/60",
    text: "text-amber-700 dark:text-amber-500",
  },
  away: {
    border: "border-red-300 dark:border-red-900",
    ring: "border-red-500/60",
    text: "text-red-700 dark:text-red-400",
  },
};

function ScorelineRow({ line }: { line: Scoreline }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <span className="font-medium tabular-nums">
        {line.home}–{line.away}
      </span>
      <span className="text-xs text-muted-foreground">×{line.count}</span>
    </div>
  );
}

function OutcomeColumn({
  title,
  bucket,
  tone,
  emptyLabel,
}: {
  title: string;
  bucket: OutcomeBucket;
  tone: Tone;
  emptyLabel: string;
}) {
  const t = TONE[tone];
  return (
    <div className={`space-y-3 rounded-xl border ${t.border} p-3`}>
      <div className="space-y-2">
        <div className={`text-center text-xs font-semibold uppercase tracking-wide ${t.text}`}>
          {title}
        </div>
        <div className="text-center">
          <span className={`text-2xl font-bold ${t.text}`}>{bucket.count}</span>
          <span className="ml-1.5 text-sm text-muted-foreground">
            ({bucket.pct}%)
          </span>
        </div>
      </div>
      <div className="space-y-1.5">
        {bucket.top.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          bucket.top.map((line) => <ScorelineRow key={line.label} line={line} />)
        )}
      </div>
    </div>
  );
}

export function NextMatchStatsPanel({
  homeName,
  awayName,
  kickoffLabel,
  stats,
  labels,
}: Props) {
  const hasData = stats.total > 0;

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#1A2855] dark:text-foreground">
          {homeName} – {awayName}
        </h2>
        <span className="text-sm text-muted-foreground">{kickoffLabel}</span>
      </div>

      {!hasData ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {labels.noPredictions}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Mode + average */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.modeTitle}
              </div>
              <div className="mt-1">
                <span className="text-2xl font-bold text-[#1A2855] dark:text-foreground tabular-nums">
                  {stats.mode ? `${stats.mode.home}–${stats.mode.away}` : "—"}
                </span>
                {stats.mode && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    ×{stats.mode.count}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.averageTitle}
              </div>
              <div className="mt-1 text-2xl font-bold text-[#1A2855] dark:text-foreground tabular-nums">
                {stats.avgHome} – {stats.avgAway}
              </div>
            </div>
          </div>

          {/* Outcomes */}
          <div className="grid gap-3 sm:grid-cols-3">
            <OutcomeColumn
              title={`${labels.topPrefix} ${homeName} ${labels.winsWord}`}
              bucket={stats.homeWins}
              tone="home"
              emptyLabel="—"
            />
            <OutcomeColumn
              title={labels.drawsWord}
              bucket={stats.draws}
              tone="draw"
              emptyLabel="—"
            />
            <OutcomeColumn
              title={`${labels.topPrefix} ${awayName} ${labels.winsWord}`}
              bucket={stats.awayWins}
              tone="away"
              emptyLabel="—"
            />
          </div>
        </div>
      )}
    </section>
  );
}
