import { describe, it, expect } from "vitest";
import {
  computeEliminatedTeams,
  type EliminationMatch,
} from "../lib/scoring/eliminated";

const group = (
  home: string,
  away: string,
  hs: number | null = null,
  as: number | null = null,
  status = hs == null ? "scheduled" : "finished"
): EliminationMatch => ({
  stage: "group",
  status,
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
});

const ko = (
  home: string | null,
  away: string | null,
  hs: number | null = null,
  as: number | null = null,
  extra: Partial<EliminationMatch> = {}
): EliminationMatch => ({
  stage: "r16",
  status: hs == null ? "scheduled" : "finished",
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
  ...extra,
});

describe("computeEliminatedTeams", () => {
  it("marks nobody during the group stage (no knockout teams assigned)", () => {
    const out = computeEliminatedTeams([
      group("bra", "ger", 2, 0),
      ko(null, null),
    ]);
    expect(out.size).toBe(0);
  });

  it("marks group teams absent from the knockout bracket", () => {
    const out = computeEliminatedTeams([
      group("bra", "ger", 2, 0),
      group("esp", "jpn", 1, 0),
      ko("bra", "esp"),
    ]);
    expect(out).toEqual(new Set(["ger", "jpn"]));
  });

  it("marks the loser of a finished knockout match", () => {
    const out = computeEliminatedTeams([ko("bra", "nor", 1, 2)]);
    expect(out).toEqual(new Set(["bra"]));
  });

  it("uses the penalty/advancing winner on a knockout draw", () => {
    const out = computeEliminatedTeams([
      ko("esp", "arg", 1, 1, { penaltyWinnerTeamId: "arg" }),
      ko("fra", "eng", 0, 0, { advancingTeamId: "fra" }),
    ]);
    expect(out).toEqual(new Set(["esp", "eng"]));
  });

  it("skips a drawn knockout match with no recorded advancer", () => {
    const out = computeEliminatedTeams([ko("esp", "arg", 1, 1)]);
    expect(out.size).toBe(0);
  });

  it("keeps a semi-final loser alive while the third-place match is pending", () => {
    const semi = { ...ko("esp", "arg", 0, 1), stage: "semi" };
    const thirdPlace = { ...ko("esp", "mar"), stage: "third_place" };
    expect(computeEliminatedTeams([semi, thirdPlace]).has("esp")).toBe(false);

    const thirdPlayed = { ...ko("esp", "mar", 0, 1), stage: "third_place" };
    expect(computeEliminatedTeams([semi, thirdPlayed]).has("esp")).toBe(true);
  });
});
