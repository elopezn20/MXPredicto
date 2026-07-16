"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowUpIcon,
  MinusIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type { LeaderboardRow, Stage } from "@/lib/scoring/scoring";
import {
  computeWhatIfLeaderboard,
  type WhatIfPrediction,
} from "@/lib/scoring/what-if";
import { MovementIndicator } from "@/components/scoreboard/movement-indicator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PodiumPick {
  code: string;
  name: string;
  flagUrl: string | null;
  /** False once the team can no longer finish in the picked position. */
  alive: boolean;
}

export interface ScoreboardRowData extends LeaderboardRow {
  /** Real rank movement since the previous game (0 = no change). */
  move: number;
  /** Formatted pick for the next match, e.g. "1–1 (BRA)". */
  nextPick: string | null;
  /** Podio prediction in 1-2-3 order; null slots for unpicked positions. */
  podium: Array<PodiumPick | null> | null;
  isMe: boolean;
}

export interface WhatIfTeam {
  id: string;
  code: string;
  name: string;
}

export interface WhatIfConfig {
  stage: Stage;
  homeTeam: WhatIfTeam;
  awayTeam: WhatIfTeam;
  /** Everyone's locked-in pick for the next match. */
  predictions: WhatIfPrediction[];
}

interface Props {
  rows: ScoreboardRowData[];
  /** Non-null once the next match's picks are locked (visible via RLS). */
  whatIf: WhatIfConfig | null;
  /** True when a next match exists but its picks haven't locked yet. */
  whatIfPendingLock: boolean;
  /** True once Podio picks are locked and there's at least one to show. */
  showPodium: boolean;
  showNextPick: boolean;
  nextMatchCodes: string | null;
  locale: string;
  /** Prize amounts (CLP) for ranks 1..n. */
  prizes: number[];
}

function formatCLP(locale: string, amount: number): string {
  const tag = locale === "es" ? "es-CL" : locale === "ko" ? "ko-KR" : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Tied ranks split the combined pot for the positions they occupy.
// E.g. three players tied at rank 1 share prizes for positions 1, 2 and 3.
function computePrizeByRank(
  rows: Array<{ rank: number }>,
  prizes: number[]
): Map<number, number> {
  const prizeByRank = new Map<number, number>();
  for (let i = 0; i < rows.length; ) {
    const rank = rows[i]!.rank;
    let j = i;
    while (j < rows.length && rows[j]!.rank === rank) j++;
    const groupSize = j - i;
    let pot = 0;
    for (let k = 0; k < groupSize; k++) {
      pot += prizes[rank - 1 + k] ?? 0;
    }
    if (pot > 0) prizeByRank.set(rank, Math.round(pot / groupSize));
    i = j;
  }
  return prizeByRank;
}

function ScoreStepper({
  team,
  value,
  onChange,
  labels,
}: {
  team: WhatIfTeam;
  value: number;
  onChange: (v: number) => void;
  labels: { increase: string; decrease: string };
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {team.code}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={labels.decrease}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <MinusIcon aria-hidden />
        </Button>
        <span className="w-8 text-center text-3xl font-bold tabular-nums">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={labels.increase}
          disabled={value >= 20}
          onClick={() => onChange(Math.min(20, value + 1))}
        >
          <PlusIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function PodiumFlags({
  podium,
  eliminatedLabel,
}: {
  podium: Array<PodiumPick | null>;
  eliminatedLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {podium.map((pick, i) =>
        pick ? (
          <span
            key={i}
            title={`${i + 1}. ${pick.name}${pick.alive ? "" : ` — ${eliminatedLabel}`}`}
            className="relative inline-flex"
          >
            {pick.flagUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pick.flagUrl}
                alt={`${i + 1}. ${pick.code}`}
                className={cn(
                  "h-4 w-6 object-contain",
                  !pick.alive && "opacity-40 grayscale"
                )}
              />
            ) : (
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  !pick.alive && "text-muted-foreground/60 line-through"
                )}
              >
                {pick.code}
              </span>
            )}
            {!pick.alive && pick.flagUrl && (
              <span
                aria-hidden
                className="absolute left-1/2 top-1/2 h-0.5 w-[130%] -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] rounded-full bg-red-600/90"
              />
            )}
          </span>
        ) : (
          <span key={i} className="w-6 text-center text-muted-foreground">
            –
          </span>
        )
      )}
    </span>
  );
}

export function LeaderboardTable({
  rows,
  whatIf,
  whatIfPendingLock,
  showPodium,
  showNextPick,
  nextMatchCodes,
  locale,
  prizes,
}: Props) {
  const t = useTranslations("scoreboard");
  const [active, setActive] = useState(false);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [penaltyWinnerId, setPenaltyWinnerId] = useState<string | null>(null);

  const canWhatIf = !!whatIf;
  const isDraw = homeScore === awayScore;
  const needsPenaltyWinner =
    active && !!whatIf && whatIf.stage === "knockout" && isDraw;

  const whatIfRows = useMemo(() => {
    if (!active || !whatIf) return null;
    return computeWhatIfLeaderboard(rows, whatIf.predictions, {
      homeScore,
      awayScore,
      advancingTeamId: needsPenaltyWinner
        ? (penaltyWinnerId ?? whatIf.homeTeam.id)
        : null,
      homeTeamId: whatIf.homeTeam.id,
      awayTeamId: whatIf.awayTeam.id,
    }, whatIf.stage);
  }, [
    active,
    whatIf,
    rows,
    homeScore,
    awayScore,
    penaltyWinnerId,
    needsPenaltyWinner,
  ]);

  const displayRows = whatIfRows ?? rows;
  const prizeByRank = useMemo(
    () => computePrizeByRank(displayRows, prizes),
    [displayRows, prizes]
  );

  const effectivePenaltyWinnerId = penaltyWinnerId ?? whatIf?.homeTeam.id;

  return (
    <div className="space-y-3">
      {/* ── What-if entry point ──────────────────────────────────────────── */}
      {!active && (canWhatIf || whatIfPendingLock) && (
        <div className="flex flex-col items-start gap-1 print:hidden">
          <Button
            type="button"
            variant="outline"
            disabled={!canWhatIf}
            onClick={() => setActive(true)}
            className="gap-1.5 border-violet-400/60 text-violet-700 hover:bg-violet-500/10 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-400"
          >
            <SparklesIcon aria-hidden />
            {t("whatIf")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {canWhatIf ? t("whatIfHint") : t("whatIfLockedHint")}
          </p>
        </div>
      )}

      {/* ── What-if control panel ────────────────────────────────────────── */}
      {active && whatIf && (
        <div className="space-y-4 rounded-xl border-2 border-violet-500/50 bg-violet-500/5 p-4 print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-base font-bold text-violet-700 dark:text-violet-400">
                <SparklesIcon className="size-4" aria-hidden />
                {t("whatIfTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("whatIfBanner")}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActive(false)}
              className="gap-1"
            >
              <XIcon aria-hidden />
              {t("backToReal")}
            </Button>
          </div>

          <div className="flex items-end justify-center gap-4 sm:gap-6">
            <span className="hidden max-w-32 truncate pb-2 text-sm font-medium sm:block">
              {whatIf.homeTeam.name}
            </span>
            <ScoreStepper
              team={whatIf.homeTeam}
              value={homeScore}
              onChange={setHomeScore}
              labels={{
                increase: t("increaseGoals", { team: whatIf.homeTeam.name }),
                decrease: t("decreaseGoals", { team: whatIf.homeTeam.name }),
              }}
            />
            <span className="pb-1 text-2xl font-bold text-muted-foreground">
              –
            </span>
            <ScoreStepper
              team={whatIf.awayTeam}
              value={awayScore}
              onChange={setAwayScore}
              labels={{
                increase: t("increaseGoals", { team: whatIf.awayTeam.name }),
                decrease: t("decreaseGoals", { team: whatIf.awayTeam.name }),
              }}
            />
            <span className="hidden max-w-32 truncate pb-2 text-sm font-medium sm:block">
              {whatIf.awayTeam.name}
            </span>
          </div>

          {needsPenaltyWinner && (
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("penaltyWinner")}
              </span>
              <div className="flex gap-2">
                {[whatIf.homeTeam, whatIf.awayTeam].map((team) => (
                  <Button
                    key={team.id}
                    type="button"
                    size="sm"
                    variant={
                      effectivePenaltyWinnerId === team.id
                        ? "default"
                        : "outline"
                    }
                    onClick={() => setPenaltyWinnerId(team.id)}
                  >
                    {team.code}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Leaderboard table ────────────────────────────────────────────── */}
      <div
        className={cn(
          "overflow-x-auto rounded-lg border",
          whatIfRows && "border-violet-500/50 ring-1 ring-violet-500/30"
        )}
      >
        <table className="w-full text-sm">
          <thead className={whatIfRows ? "bg-violet-500/10" : "bg-muted/50"}>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                {t("rank")}
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                {t("player")}
              </th>
              {showPodium && (
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                  {t("podium")}
                </th>
              )}
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
            {displayRows.map((row) => {
              const isFirst = row.rank === 1;
              // Real mode: movement since the last game. What-if mode:
              // movement vs the current real standings.
              const move = whatIfRows
                ? (row as (typeof whatIfRows)[number]).moveVsReal
                : row.move;
              const gained = whatIfRows
                ? (row as (typeof whatIfRows)[number]).gained
                : null;
              const prizeAmount = prizeByRank.get(row.rank);
              const prize =
                prizeAmount !== undefined
                  ? formatCLP(locale, prizeAmount)
                  : "—";
              return (
                <tr
                  key={row.userId}
                  className={cn(
                    "transition-colors hover:bg-muted/30",
                    isFirst &&
                      "bg-highlight/15 ring-1 ring-inset ring-highlight/40 hover:bg-highlight/20",
                    row.isMe && !isFirst && "bg-highlight/10 font-semibold"
                  )}
                >
                  <td
                    className={cn(
                      "px-3 text-muted-foreground",
                      isFirst ? "py-4" : "py-2.5"
                    )}
                  >
                    <span className={cn(isFirst && "text-3xl")}>
                      {row.rank === 1
                        ? "🥇"
                        : row.rank === 2
                          ? "🥈"
                          : row.rank === 3
                            ? "🥉"
                            : row.rank}
                    </span>
                  </td>
                  <td className={cn("px-3", isFirst ? "py-4" : "py-2.5")}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="flex w-7 shrink-0 justify-end">
                        {move !== 0 && (
                          <MovementIndicator
                            delta={move}
                            title={
                              whatIfRows
                                ? t(move > 0 ? "whatIfUp" : "whatIfDown", {
                                    count: Math.abs(move),
                                  })
                                : t(move > 0 ? "rankUp" : "rankDown", {
                                    count: Math.abs(move),
                                  })
                            }
                          />
                        )}
                      </span>
                      <Link
                        href={`/${locale}/profile/${row.userId}`}
                        className={cn(
                          "hover:underline",
                          isFirst && "text-lg font-bold text-foreground"
                        )}
                      >
                        {row.displayName}
                      </Link>
                      {row.isMe && (
                        <span className="text-xs text-muted-foreground">
                          {t("you")}
                        </span>
                      )}
                    </span>
                  </td>
                  {showPodium && (
                    <td
                      className={cn(
                        "px-3 text-center",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      {row.podium ? (
                        <PodiumFlags
                          podium={row.podium}
                          eliminatedLabel={t("podiumEliminated")}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {showNextPick && (
                    <td
                      className={cn(
                        "px-3 text-center tabular-nums text-muted-foreground",
                        isFirst ? "py-4" : "py-2.5"
                      )}
                    >
                      {row.nextPick ?? "—"}
                    </td>
                  )}
                  <td
                    className={cn(
                      "px-3 text-right font-bold text-primary",
                      isFirst ? "py-4 text-xl" : "py-2.5"
                    )}
                  >
                    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                      {gained !== null && (
                        <span
                          title={t("whatIfGain")}
                          aria-label={t("whatIfGain")}
                          className={cn(
                            "inline-flex items-center text-xs font-semibold tabular-nums",
                            gained > 0
                              ? "text-green-600"
                              : "text-muted-foreground/60"
                          )}
                        >
                          {gained > 0 && (
                            <ArrowUpIcon className="size-3" aria-hidden />
                          )}
                          +{gained}
                        </span>
                      )}
                      {row.totalPoints}
                    </span>
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
                    {row.deltaFromLeader < 0 ? `${row.deltaFromLeader}` : "—"}
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

      {/* Repeat the exit affordance below the table so it's never far away. */}
      {active && whatIf && (
        <div className="flex justify-center print:hidden">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setActive(false)}
            className="gap-1"
          >
            <XIcon aria-hidden />
            {t("backToReal")}
          </Button>
        </div>
      )}
    </div>
  );
}
