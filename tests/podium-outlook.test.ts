import { describe, it, expect } from "vitest";
import {
  computePodiumOutlook,
  type PodiumMatch,
} from "../lib/scoring/podium-outlook";

const ko = (
  nameKey: string,
  home: string | null,
  away: string | null,
  hs: number | null = null,
  as: number | null = null,
  advancing: string | null = null
): PodiumMatch => ({
  stage: "knockout",
  nameKey,
  status: hs == null ? "scheduled" : "finished",
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
  advancingTeamId: advancing,
});

describe("computePodiumOutlook", () => {
  it("final assigned: only the finalists can be 1st or 2nd", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_final", "esp", "arg"),
      ko("rounds.knockout_3rd", "fra", "eng"),
    ]);
    expect(out.canBeChampion("esp")).toBe(true);
    expect(out.canBeChampion("arg")).toBe(true);
    expect(out.canBeChampion("fra")).toBe(false);
    expect(out.canBeRunnerUp("arg")).toBe(true);
    expect(out.canBeRunnerUp("eng")).toBe(false);
  });

  it("third-place match assigned: only its teams can be 3rd", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_final", "esp", "arg"),
      ko("rounds.knockout_3rd", "fra", "eng"),
    ]);
    expect(out.canBeThird("fra")).toBe(true);
    expect(out.canBeThird("eng")).toBe(true);
    expect(out.canBeThird("esp")).toBe(false);
    expect(out.canBeThird("arg")).toBe(false);
  });

  it("final played: winner is the only champion, loser the only runner-up", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_final", "esp", "arg", 2, 1),
    ]);
    expect(out.canBeChampion("esp")).toBe(true);
    expect(out.canBeChampion("arg")).toBe(false);
    expect(out.canBeRunnerUp("arg")).toBe(true);
    expect(out.canBeRunnerUp("esp")).toBe(false);
  });

  it("drawn final resolved by advancing team", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_final", "esp", "arg", 1, 1, "arg"),
    ]);
    expect(out.canBeChampion("arg")).toBe(true);
    expect(out.canBeChampion("esp")).toBe(false);
  });

  it("third-place match played: only the winner can be 3rd", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_3rd", "fra", "eng", 0, 3),
    ]);
    expect(out.canBeThird("eng")).toBe(true);
    expect(out.canBeThird("fra")).toBe(false);
  });

  it("final not yet assigned: falls back to eliminated teams", () => {
    const out = computePodiumOutlook([
      ko("rounds.knockout_sf", "esp", "fra", 2, 0),
      ko("rounds.knockout_final", null, null),
    ]);
    // fra lost the semi with no upcoming match assigned → eliminated
    expect(out.canBeChampion("esp")).toBe(true);
    expect(out.canBeChampion("fra")).toBe(false);
  });
});
