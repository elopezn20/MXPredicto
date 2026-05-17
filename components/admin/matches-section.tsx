"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateMatchResult } from "@/lib/actions/admin";

interface Team {
  id: string;
  code: string;
  name_en: string;
}

interface Match {
  id: string;
  status: string;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  penalty_winner_team_id: string | null;
  advancing_team_id: string | null;
  home_team: Team | Team[] | null;
  away_team: Team | Team[] | null;
}

interface Round {
  id: string;
  name_key: string;
  order_index: number;
  stage: string;
  matches: Match[] | null;
}

interface Props {
  rounds: Round[];
  allTeams: Team[];
}

function getTeam(t: Team | Team[] | null): Team | null {
  if (!t) return null;
  return Array.isArray(t) ? (t[0] ?? null) : t;
}

function MatchRow({
  match,
  isKnockout,
  allTeams,
}: {
  match: Match;
  isKnockout: boolean;
  allTeams: Team[];
}) {
  const t = useTranslations("admin.matches");
  const ht = getTeam(match.home_team);
  const at = getTeam(match.away_team);

  const [status, setStatus] = useState(match.status);
  const [homeScore, setHomeScore] = useState<string>(
    match.home_score != null ? String(match.home_score) : ""
  );
  const [awayScore, setAwayScore] = useState<string>(
    match.away_score != null ? String(match.away_score) : ""
  );
  const [penWinnerId, setPenWinnerId] = useState<string>(
    match.penalty_winner_team_id ?? ""
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  const homeVal = homeScore !== "" ? parseInt(homeScore, 10) : null;
  const awayVal = awayScore !== "" ? parseInt(awayScore, 10) : null;

  // Advancing team: derived from score + penalty winner
  function deriveAdvancingId(): string | null {
    if (isKnockout && penWinnerId) return penWinnerId;
    if (homeVal != null && awayVal != null) {
      if (homeVal > awayVal) return ht?.id ?? null;
      if (awayVal > homeVal) return at?.id ?? null;
    }
    return null;
  }

  function handleSave() {
    setSaveState("saving");
    startTransition(async () => {
      const result = await updateMatchResult({
        matchId: match.id,
        homeScore: homeVal,
        awayScore: awayVal,
        status: status as "scheduled" | "in_progress" | "finished",
        penaltyWinnerTeamId: penWinnerId || null,
        advancingTeamId: deriveAdvancingId(),
      });
      setSaveState(result.ok ? "saved" : "error");
      if (result.ok) setTimeout(() => setSaveState("idle"), 2000);
    });
  }

  const showPenPicker =
    isKnockout &&
    homeVal != null &&
    awayVal != null &&
    homeVal === awayVal &&
    ht &&
    at;

  return (
    <tr className="border-b text-xs hover:bg-muted/20">
      <td className="px-2 py-1.5 font-medium">
        {ht?.code ?? "?"} vs {at?.code ?? "?"}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">
        {new Date(match.kickoff_at).toLocaleDateString()}
      </td>
      <td className="px-2 py-1.5">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border bg-background px-1 py-0.5 text-xs"
        >
          <option value="scheduled">{t("scheduled")}</option>
          <option value="in_progress">{t("inProgress")}</option>
          <option value="finished">{t("finished")}</option>
        </select>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={99}
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            placeholder={t("homeScore")}
            className="w-10 rounded border bg-background px-1 py-0.5 text-center text-xs"
          />
          <span>–</span>
          <input
            type="number"
            min={0}
            max={99}
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            placeholder={t("awayScore")}
            className="w-10 rounded border bg-background px-1 py-0.5 text-center text-xs"
          />
        </div>
      </td>
      {isKnockout && (
        <td className="px-2 py-1.5">
          {showPenPicker ? (
            <select
              value={penWinnerId}
              onChange={(e) => setPenWinnerId(e.target.value)}
              className="rounded border bg-background px-1 py-0.5 text-xs"
            >
              <option value="">—</option>
              <option value={ht.id}>{ht.code}</option>
              <option value={at.id}>{at.code}</option>
            </select>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-1.5 text-right">
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={isPending}
          className="h-6 text-xs"
        >
          {saveState === "saving"
            ? t("saving")
            : saveState === "saved"
            ? t("saved")
            : saveState === "error"
            ? "Error"
            : t("save")}
        </Button>
      </td>
    </tr>
  );
}

export function MatchesSection({ rounds, allTeams }: Props) {
  const t = useTranslations("admin.matches");
  const tRounds = useTranslations("rounds");

  return (
    <div className="space-y-6">
      {rounds.map((round) => {
        const matches = (round.matches ?? []).sort(
          (a, b) =>
            new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime()
        );
        if (matches.length === 0) return null;

        const isKnockout = round.stage === "knockout";
        const roundKey = round.name_key.replace(
          "rounds.",
          ""
        ) as Parameters<typeof tRounds>[0];

        return (
          <section key={round.id}>
            <h2 className="mb-2 font-semibold">{tRounds(roundKey)}</h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Match
                    </th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      {t("status")}
                    </th>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                      Score
                    </th>
                    {isKnockout && (
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">
                        {t("penaltyWinner")}
                      </th>
                    )}
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {matches.map((match) => (
                    <MatchRow
                      key={match.id}
                      match={match}
                      isKnockout={isKnockout}
                      allTeams={allTeams}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
