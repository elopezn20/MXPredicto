"use client";

import { useState } from "react";
import type {
  NextMatchStats,
  OutcomeBucket,
  Scoreline,
} from "@/lib/scoring/next-match-stats";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface NextMatchStatsLabels {
  heading: string; // "Next match"
  modeTitle: string; // "Mode (most predicted)"
  averageTitle: string; // "Average score"
  topPrefix: string; // "Top" → "Top {home} wins"
  winsWord: string; // "wins"
  drawsWord: string; // "Draws"
  noPredictions: string; // shown when nobody has predicted
  highVariety: string; // tiny alert when predictions are very scattered
  pickedBy: string; // "Picked by" — popover heading
}

interface Props {
  homeName: string;
  awayName: string;
  kickoff: React.ReactNode;
  stats: NextMatchStats;
  labels: NextMatchStatsLabels;
  /** Display names of the players who picked each scoreline, keyed by "home-away". */
  usersByScoreline: Record<string, string[]>;
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

function ScorelineRow({
  line,
  users,
  pickedByLabel,
}: {
  line: Scoreline;
  users: string[];
  pickedByLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <span className="font-medium tabular-nums">
          {line.home}–{line.away}
        </span>
        <span className="text-xs text-muted-foreground">×{line.count}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto">
        <PopoverTitle className="font-bold">{pickedByLabel}</PopoverTitle>
        <ul className="space-y-1">
          {users.map((name, i) => (
            <li key={`${name}-${i}`} className="truncate text-sm">
              {name}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function OutcomeColumn({
  title,
  bucket,
  tone,
  emptyLabel,
  usersByScoreline,
  pickedByLabel,
}: {
  title: string;
  bucket: OutcomeBucket;
  tone: Tone;
  emptyLabel: string;
  usersByScoreline: Record<string, string[]>;
  pickedByLabel: string;
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
          bucket.top.map((line) => (
            <ScorelineRow
              key={line.label}
              line={line}
              users={usersByScoreline[line.label] ?? []}
              pickedByLabel={pickedByLabel}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function NextMatchStatsPanel({
  homeName,
  awayName,
  kickoff,
  stats,
  labels,
  usersByScoreline,
}: Props) {
  const hasData = stats.total > 0;

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-primary">
          {homeName} – {awayName}
        </h2>
        <span className="text-sm text-muted-foreground">{kickoff}</span>
      </div>

      {!hasData ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {labels.noPredictions}
        </p>
      ) : (
        <div className="space-y-4">
          {stats.highVariety && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
              </svg>
              <span>{labels.highVariety}</span>
            </div>
          )}

          {/* Mode + average */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {labels.modeTitle}
              </div>
              <div className="mt-1">
                <span className="text-2xl font-bold text-foreground tabular-nums">
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
              <div className="mt-1 text-2xl font-bold text-foreground tabular-nums">
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
              usersByScoreline={usersByScoreline}
              pickedByLabel={labels.pickedBy}
            />
            <OutcomeColumn
              title={labels.drawsWord}
              bucket={stats.draws}
              tone="draw"
              emptyLabel="—"
              usersByScoreline={usersByScoreline}
              pickedByLabel={labels.pickedBy}
            />
            <OutcomeColumn
              title={`${labels.topPrefix} ${awayName} ${labels.winsWord}`}
              bucket={stats.awayWins}
              tone="away"
              emptyLabel="—"
              usersByScoreline={usersByScoreline}
              pickedByLabel={labels.pickedBy}
            />
          </div>
        </div>
      )}
    </section>
  );
}
