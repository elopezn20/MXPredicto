import { describe, it, expect } from "vitest";
import { computeWhatIfLeaderboard } from "../lib/scoring/what-if";
import type { LeaderboardRow } from "../lib/scoring/scoring";

// ── Helpers ───────────────────────────────────────────────────────────────────

const HOME = "team-home";
const AWAY = "team-away";

function row(
  userId: string,
  rank: number,
  totalPoints: number,
  matchesHit = 0,
  zeroMatches = 0
): LeaderboardRow {
  return {
    rank,
    userId,
    displayName: userId,
    totalPoints,
    matchesHit,
    zeroMatches,
    deltaFromLeader: 0,
  };
}

function pick(
  userId: string,
  homeScore: number,
  awayScore: number,
  penaltyWinnerTeamId: string | null = null
) {
  return { userId, homeScore, awayScore, penaltyWinnerTeamId };
}

function result(
  homeScore: number,
  awayScore: number,
  advancingTeamId: string | null = null
) {
  return {
    homeScore,
    awayScore,
    advancingTeamId,
    homeTeamId: HOME,
    awayTeamId: AWAY,
  };
}

// ── Points and re-ranking ─────────────────────────────────────────────────────

describe("computeWhatIfLeaderboard — group stage", () => {
  it("awards points per pick and re-ranks by new totals", () => {
    const base = [row("a", 1, 20), row("b", 2, 18), row("c", 3, 15)];
    // Result 2-1: b nails it (10), c gets result + away goals (7), a misses (0).
    const rows = computeWhatIfLeaderboard(
      base,
      [pick("a", 0, 0), pick("b", 2, 1), pick("c", 3, 1)],
      result(2, 1),
      "group"
    );

    expect(rows.map((r) => [r.userId, r.rank, r.totalPoints, r.gained])).toEqual([
      ["b", 1, 28, 10],
      ["c", 2, 22, 7],
      ["a", 3, 20, 0],
    ]);
  });

  it("reports rank movement vs the real scoreboard", () => {
    const base = [row("a", 1, 20), row("b", 2, 18), row("c", 3, 15)];
    const rows = computeWhatIfLeaderboard(
      base,
      [pick("b", 2, 1), pick("c", 2, 1)],
      result(2, 1),
      "group"
    );
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect(byUser.get("b")!.moveVsReal).toBe(1); // 2 → 1
    expect(byUser.get("c")!.moveVsReal).toBe(1); // 3 → 2
    expect(byUser.get("a")!.moveVsReal).toBe(-2); // 1 → 3
  });

  it("counts a perfect pick as a hit and a miss as a zero (tie-breaks)", () => {
    // Same new totals; b's perfect pick must out-rank a's partial points.
    const base = [row("a", 1, 20, 1, 0), row("b", 2, 15, 1, 0)];
    const rows = computeWhatIfLeaderboard(
      base,
      [pick("a", 3, 0), pick("b", 2, 1)],
      result(2, 1),
      "group"
    );
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect(byUser.get("a")!.gained).toBe(5); // result only
    expect(byUser.get("b")!.gained).toBe(10); // perfect → hit
    expect(byUser.get("a")!.totalPoints).toBe(25);
    expect(byUser.get("b")!.totalPoints).toBe(25);
    expect(byUser.get("b")!.matchesHit).toBe(2);
    expect(byUser.get("b")!.rank).toBe(1);
    expect(byUser.get("a")!.rank).toBe(2);
  });

  it("players without a pick gain 0 and a zero-match", () => {
    const base = [row("a", 1, 20, 0, 1)];
    const rows = computeWhatIfLeaderboard(base, [], result(1, 0), "group");
    expect(rows[0]!.gained).toBe(0);
    expect(rows[0]!.zeroMatches).toBe(2);
  });

  it("recomputes deltaFromLeader against the what-if leader", () => {
    const base = [row("a", 1, 20), row("b", 2, 12)];
    const rows = computeWhatIfLeaderboard(
      base,
      [pick("b", 1, 1)],
      result(1, 1),
      "group"
    );
    expect(rows[0]!.userId).toBe("b"); // 12 + 10 = 22
    expect(rows[0]!.deltaFromLeader).toBe(0);
    expect(rows[1]!.deltaFromLeader).toBe(-2); // 20 - 22
  });
});

describe("computeWhatIfLeaderboard — knockout", () => {
  it("a non-draw result makes the FT winner the advancing team", () => {
    const base = [row("a", 1, 0)];
    // a predicted away win 0-1; hypothetical 0-2 away win → result 10 + away
    // goals 0 + advance 5 = 15... away goals pred 1 ≠ 2, diff -1 ≠ -2.
    const rows = computeWhatIfLeaderboard(
      base,
      [pick("a", 0, 1)],
      result(0, 2),
      "knockout"
    );
    expect(rows[0]!.gained).toBe(10 + 4 + 5); // result + home goals (0=0) + advance
  });

  it("a draw uses the selected penalty winner for advance points", () => {
    const base = [row("a", 1, 0), row("b", 2, 0)];
    const picks = [pick("a", 1, 1, HOME), pick("b", 1, 1, AWAY)];
    // Hypothetical 1-1, home advances on pens.
    const rows = computeWhatIfLeaderboard(
      base,
      picks,
      result(1, 1, HOME),
      "knockout"
    );
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    // Perfect: result 10 + goals 8 + diff 2 + advance 5 = 25 (a hit).
    expect(byUser.get("a")!.gained).toBe(25);
    expect(byUser.get("a")!.matchesHit).toBe(1);
    // Same scoreline but wrong penalty winner: 25 - 5 = 20.
    expect(byUser.get("b")!.gained).toBe(20);
    expect(byUser.get("b")!.matchesHit).toBe(0);
  });

  it("preserves extra display fields on the rows", () => {
    const base = [{ ...row("a", 1, 0), nextPick: "1–1", isMe: true }];
    const rows = computeWhatIfLeaderboard(base, [], result(1, 0), "knockout");
    expect(rows[0]!.nextPick).toBe("1–1");
    expect(rows[0]!.isMe).toBe(true);
  });
});
