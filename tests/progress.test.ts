import { describe, it, expect } from "vitest";
import {
  computeRankTrajectory,
  computePlayerRankStats,
} from "../lib/scoring/progress";

const users = [
  { id: "a", displayName: "Ana" },
  { id: "b", displayName: "Beto" },
  { id: "c", displayName: "Caro" },
];

describe("computeRankTrajectory", () => {
  it("returns one point per finished match in order", () => {
    const traj = computeRankTrajectory(users, ["m1", "m2"], [], "a");
    expect(traj.map((p) => p.matchId)).toEqual(["m1", "m2"]);
    expect(traj.map((p) => p.index)).toEqual([0, 1]);
  });

  it("tracks rank as points accumulate", () => {
    const preds = [
      // m1: Ana 10, Beto 5, Caro 0
      { userId: "a", matchId: "m1", pointsAwarded: 10 },
      { userId: "b", matchId: "m1", pointsAwarded: 5 },
      { userId: "c", matchId: "m1", pointsAwarded: 0 },
      // m2: Caro 10, others 0 → totals a:10 b:5 c:10
      { userId: "c", matchId: "m2", pointsAwarded: 10 },
    ];
    const traj = computeRankTrajectory(users, ["m1", "m2"], preds, "a");

    // After m1 Ana leads.
    expect(traj[0]).toMatchObject({
      rank: 1,
      cumulativePoints: 10,
      pointsThisMatch: 10,
      totalPlayers: 3,
    });

    // After m2 Ana (10pts, 1 hit, 1 zero) is fully tied with Caro (10pts, 1 hit,
    // 1 zero), so neither is "ahead" → both share rank 1.
    expect(traj[1]).toMatchObject({ rank: 1, cumulativePoints: 10 });
  });

  it("counts unpredicted finished matches as zeros", () => {
    const preds = [{ userId: "b", matchId: "m1", pointsAwarded: 10 }];
    const traj = computeRankTrajectory(users, ["m1"], preds, "a");
    expect(traj[0]).toMatchObject({ rank: 2, cumulativePoints: 0, pointsThisMatch: 0 });
  });

  it("returns empty when there are no finished matches", () => {
    expect(computeRankTrajectory(users, [], [], "a")).toEqual([]);
  });
});

describe("computePlayerRankStats", () => {
  const preds = [
    // m1: Ana 10, Beto 5, Caro 0
    { userId: "a", matchId: "m1", pointsAwarded: 10 },
    { userId: "b", matchId: "m1", pointsAwarded: 5 },
    { userId: "c", matchId: "m1", pointsAwarded: 0 },
    // m2: Caro 10, others 0
    { userId: "c", matchId: "m2", pointsAwarded: 10 },
  ];

  it("tracks best and worst rank reached over time", () => {
    const stats = computePlayerRankStats(users, ["m1", "m2"], preds);
    const by = Object.fromEntries(stats.map((s) => [s.userId, s]));

    // Ana: rank 1 then 1 → best 1, worst 1; 1 hit, 1 zero (m2 unpredicted).
    expect(by.a).toMatchObject({
      bestRank: 1,
      worstRank: 1,
      hits: 1,
      zeros: 1,
      currentRank: 1,
      totalPoints: 10,
    });
    // Caro: rank 3 then 1 → best 1, worst 3.
    expect(by.c).toMatchObject({ bestRank: 1, worstRank: 3, hits: 1, zeros: 1 });
    // Beto: rank 2 then 3 → best 2, worst 3; never a hit.
    expect(by.b).toMatchObject({
      bestRank: 2,
      worstRank: 3,
      hits: 0,
      currentRank: 3,
    });
  });

  it("returns null best/worst when no matches are finished", () => {
    const stats = computePlayerRankStats(users, [], []);
    expect(stats.every((s) => s.bestRank === null && s.worstRank === null)).toBe(
      true
    );
  });
});
