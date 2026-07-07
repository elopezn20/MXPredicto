export interface EliminationMatch {
  /** "group" or a knockout stage. */
  stage: string;
  status: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  advancingTeamId?: string | null;
  penaltyWinnerTeamId?: string | null;
}

/**
 * Teams that are out of the tournament, derived from match data:
 *
 * - A team that played the group stage but appears in no knockout match is
 *   eliminated — only once the knockout bracket has assigned teams, so
 *   nothing is marked during the group stage itself.
 * - The loser of a finished knockout match is eliminated, unless it still has
 *   an upcoming match with teams assigned (a semi-final loser stays alive for
 *   the third-place game).
 */
export function computeEliminatedTeams(
  matches: EliminationMatch[]
): Set<string> {
  const eliminated = new Set<string>();

  const knockoutAssigned = matches.filter(
    (m) => m.stage !== "group" && m.homeTeamId && m.awayTeamId
  );

  // Group-stage exits: in a group match, absent from the knockout bracket.
  if (knockoutAssigned.length > 0) {
    const inKnockout = new Set<string>();
    for (const m of knockoutAssigned) {
      inKnockout.add(m.homeTeamId!);
      inKnockout.add(m.awayTeamId!);
    }
    for (const m of matches) {
      if (m.stage !== "group") continue;
      for (const teamId of [m.homeTeamId, m.awayTeamId]) {
        if (teamId && !inKnockout.has(teamId)) eliminated.add(teamId);
      }
    }
  }

  // Teams with a match still to play are not out, whatever they just lost.
  const stillScheduled = new Set<string>();
  for (const m of knockoutAssigned) {
    if (m.status !== "finished") {
      stillScheduled.add(m.homeTeamId!);
      stillScheduled.add(m.awayTeamId!);
    }
  }

  // Knockout losers.
  for (const m of knockoutAssigned) {
    if (m.status !== "finished") continue;
    if (m.homeScore == null || m.awayScore == null) continue;

    let winner: string | null = null;
    if (m.homeScore > m.awayScore) winner = m.homeTeamId!;
    else if (m.awayScore > m.homeScore) winner = m.awayTeamId!;
    else winner = m.advancingTeamId ?? m.penaltyWinnerTeamId ?? null;

    if (!winner) continue;
    const loser = winner === m.homeTeamId ? m.awayTeamId! : m.homeTeamId!;
    if (!stillScheduled.has(loser)) eliminated.add(loser);
  }

  return eliminated;
}
