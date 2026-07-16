import {
  computeEliminatedTeams,
  type EliminationMatch,
} from "./eliminated";

export interface PodiumMatch extends EliminationMatch {
  /** The round's i18n name_key, e.g. "rounds.knockout_final". */
  nameKey: string | null;
}

export interface PodiumOutlook {
  canBeChampion: (teamId: string) => boolean;
  canBeRunnerUp: (teamId: string) => boolean;
  canBeThird: (teamId: string) => boolean;
}

const FINAL_KEY = "rounds.knockout_final";
const THIRD_KEY = "rounds.knockout_3rd";

/**
 * Whether each podium position is still reachable for a given team:
 *
 * - Once the final has both teams assigned, only those two can finish 1st or
 *   2nd (only the winner / loser respectively once it's played). Same for the
 *   third-place match and 3rd.
 * - Before the deciding match is assigned, any team not yet eliminated
 *   (per computeEliminatedTeams) can still reach the position.
 */
export function computePodiumOutlook(matches: PodiumMatch[]): PodiumOutlook {
  const eliminated = computeEliminatedTeams(matches);

  const candidates = (
    nameKey: string,
    wantWinner: boolean
  ): Set<string> | null => {
    const m = matches.find(
      (match) =>
        match.nameKey === nameKey && match.homeTeamId && match.awayTeamId
    );
    if (!m) return null;

    if (
      m.status === "finished" &&
      m.homeScore != null &&
      m.awayScore != null
    ) {
      let winner: string | null = null;
      if (m.homeScore > m.awayScore) winner = m.homeTeamId!;
      else if (m.awayScore > m.homeScore) winner = m.awayTeamId!;
      else winner = m.advancingTeamId ?? m.penaltyWinnerTeamId ?? null;

      if (winner) {
        const loser = winner === m.homeTeamId ? m.awayTeamId! : m.homeTeamId!;
        return new Set([wantWinner ? winner : loser]);
      }
    }
    return new Set([m.homeTeamId!, m.awayTeamId!]);
  };

  const champion = candidates(FINAL_KEY, true);
  const runnerUp = candidates(FINAL_KEY, false);
  const third = candidates(THIRD_KEY, true);

  const can = (set: Set<string> | null, teamId: string) =>
    set ? set.has(teamId) : !eliminated.has(teamId);

  return {
    canBeChampion: (teamId) => can(champion, teamId),
    canBeRunnerUp: (teamId) => can(runnerUp, teamId),
    canBeThird: (teamId) => can(third, teamId),
  };
}
