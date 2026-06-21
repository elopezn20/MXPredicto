import { describe, it, expect } from "vitest";
import {
  computeNextMatchStats,
  type RawPrediction,
} from "../lib/scoring/next-match-stats";

// Build `count` predictions of a given scoreline.
function many(home: number, away: number, count: number): RawPrediction[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: `u-${home}-${away}-${i}`,
    homeScore: home,
    awayScore: away,
  }));
}

describe("computeNextMatchStats — empty", () => {
  it("returns zeroed stats with no predictions", () => {
    const s = computeNextMatchStats([]);
    expect(s.total).toBe(0);
    expect(s.mode).toBeNull();
    expect(s.avgHome).toBeNull();
    expect(s.avgAway).toBeNull();
    expect(s.homeWins.count).toBe(0);
    expect(s.homeWins.top).toEqual([]);
  });
});

describe("computeNextMatchStats — CAN vs BIH mockup", () => {
  // home = CAN (wins), away = BIH. Reproduces the design mockup exactly.
  const preds: RawPrediction[] = [
    ...many(1, 0, 19), // top CAN win + overall mode
    ...many(2, 1, 17),
    ...many(2, 0, 9),
    ...many(1, 1, 12), // draws
    ...many(0, 1, 2), // BIH wins
    ...many(1, 2, 2),
    ...many(0, 2, 1),
  ];
  // 19+17+9 = 45 home, 12 draws, 2+2+1 = 5 away → 62 total
  const s = computeNextMatchStats(preds);

  it("total counts all predictions", () => {
    expect(s.total).toBe(62);
  });

  it("mode is the single most-predicted scoreline", () => {
    expect(s.mode?.label).toBe("1-0");
    expect(s.mode?.count).toBe(19);
  });

  it("average score matches mockup (1.4 - 0.6)", () => {
    // home: (19+34+18+12+2+1+0)/62, away: (0+17+0+12+2+4+2)/62
    expect(s.avgHome).toBe(1.4);
    expect(s.avgAway).toBe(0.6);
  });

  it("outcome counts and percentages", () => {
    expect(s.homeWins.count).toBe(45);
    expect(s.homeWins.pct).toBe(72.6);
    expect(s.draws.count).toBe(12);
    expect(s.draws.pct).toBe(19.4);
    expect(s.awayWins.count).toBe(5);
    expect(s.awayWins.pct).toBe(8.1);
  });

  it("top home wins are ordered by count desc, capped at 3", () => {
    expect(s.homeWins.top.map((t) => `${t.label}×${t.count}`)).toEqual([
      "1-0×19",
      "2-1×17",
      "2-0×9",
    ]);
  });

  it("top draws lists only draw scorelines", () => {
    expect(s.draws.top.map((t) => `${t.label}×${t.count}`)).toEqual(["1-1×12"]);
  });

  it("top away wins ordered by count then scoreline", () => {
    // 0-1 and 1-2 both ×2 → tie broken by lower home then away → 0-1 first.
    expect(s.awayWins.top.map((t) => `${t.label}×${t.count}`)).toEqual([
      "0-1×2",
      "1-2×2",
      "0-2×1",
    ]);
  });

  it("is not flagged as high variety (home win is the clear favourite)", () => {
    // 72.6% home wins → a majority result, so no alert despite varied scores.
    expect(s.highVariety).toBe(false);
  });
});

describe("computeNextMatchStats — variety flag (outcome spread)", () => {
  it("flags a genuine three-way split on the result", () => {
    // Even across home win / draw / away win, varied scorelines within each.
    const s = computeNextMatchStats([
      ...many(1, 0, 3),
      ...many(2, 1, 1), // 4 home wins
      ...many(1, 1, 3),
      ...many(2, 2, 1), // 4 draws
      ...many(0, 1, 3),
      ...many(1, 2, 1), // 4 away wins
    ]);
    expect(s.highVariety).toBe(true);
    expect(s.outcomeSpread).toBeGreaterThan(0.9);
  });

  it("flags a home-vs-away coin flip with almost no draws", () => {
    const s = computeNextMatchStats([...many(1, 0, 6), ...many(0, 1, 6)]);
    expect(s.highVariety).toBe(true);
  });

  it("does NOT flag varied scorelines that agree on the result", () => {
    // 12 different home-win scorelines → high scoreline variety, one result.
    const s = computeNextMatchStats([
      ...many(1, 0, 3),
      ...many(2, 1, 3),
      ...many(3, 0, 3),
      ...many(2, 0, 3),
    ]);
    expect(s.highVariety).toBe(false);
    expect(s.outcomeSpread).toBe(0);
  });

  it("does not flag a split below the minimum sample", () => {
    const s = computeNextMatchStats([
      ...many(1, 0, 1),
      ...many(1, 1, 1),
      ...many(0, 1, 1),
    ]);
    expect(s.highVariety).toBe(false);
  });

  it("does not flag when one result holds a majority", () => {
    const s = computeNextMatchStats([
      ...many(1, 0, 11), // 55% home wins
      ...many(1, 1, 5),
      ...many(0, 1, 4),
    ]);
    expect(s.highVariety).toBe(false);
  });
});

describe("computeNextMatchStats — determinism", () => {
  it("is independent of input order", () => {
    const a = computeNextMatchStats([...many(1, 0, 2), ...many(0, 1, 2)]);
    const b = computeNextMatchStats([...many(0, 1, 2), ...many(1, 0, 2)]);
    expect(b).toEqual(a);
  });
});
