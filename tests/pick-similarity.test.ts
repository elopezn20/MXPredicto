import { describe, it, expect } from "vitest";
import {
  computePickSimilarity,
  selectNeighbours,
  type SimMatch,
  type SimPlayer,
  type SimPrediction,
  type RankedPlayer,
} from "../lib/scoring/pick-similarity";

const A: SimPlayer = { userId: "a", displayName: "Ana" };
const B: SimPlayer = { userId: "b", displayName: "Beto" };
const C: SimPlayer = { userId: "c", displayName: "Caro" };

// One group-stage match the helpers below predict against.
const M1: SimMatch = { id: "m1", stage: "group" };

function pred(
  userId: string,
  matchId: string,
  homeScore: number,
  awayScore: number
): SimPrediction {
  return { userId, matchId, homeScore, awayScore };
}

describe("computePickSimilarity — single match", () => {
  it("identical picks are maximally similar (1.0)", () => {
    const m = computePickSimilarity(
      [A, B],
      [M1],
      [pred("a", "m1", 1, 0), pred("b", "m1", 1, 0)]
    );
    expect(m.matrix[0]![1]).toBe(1);
    expect(m.matrix[1]![0]).toBe(1); // symmetric
    expect(m.shared[0]![1]).toBe(1);
  });

  it("opposite winners are maximally dissimilar (0)", () => {
    const m = computePickSimilarity(
      [A, B],
      [M1],
      [pred("a", "m1", 1, 0), pred("b", "m1", 0, 1)]
    );
    expect(m.matrix[0]![1]).toBe(0);
  });

  it("right winner, wrong margin lands in between", () => {
    // 1-0 vs 2-0: result(5) + away-goals(2) of 10 → 0.7
    const m = computePickSimilarity(
      [A, B],
      [M1],
      [pred("a", "m1", 1, 0), pred("b", "m1", 2, 0)]
    );
    expect(m.matrix[0]![1]).toBe(0.7);
  });

  it("leaves the diagonal blank", () => {
    const m = computePickSimilarity([A, B], [M1], [pred("a", "m1", 1, 0)]);
    expect(m.matrix[0]![0]).toBeNull();
    expect(m.matrix[1]![1]).toBeNull();
  });
});

describe("computePickSimilarity — multiple matches", () => {
  const matches: SimMatch[] = [
    { id: "m1", stage: "group" },
    { id: "m2", stage: "group" },
    { id: "m3", stage: "group" },
  ];

  it("averages similarity points across shared matches", () => {
    // m1: 1-0 vs 1-0 → 10; m2: 2-1 vs 1-1 → 2; m3: 0-0 vs 0-1 → 2.
    // (10+2+2)/30 = 0.4667 → 0.47
    const sim = computePickSimilarity(
      [A, B],
      matches,
      [
        pred("a", "m1", 1, 0),
        pred("a", "m2", 2, 1),
        pred("a", "m3", 0, 0),
        pred("b", "m1", 1, 0),
        pred("b", "m2", 1, 1),
        pred("b", "m3", 0, 1),
      ]
    );
    expect(sim.matrix[0]![1]).toBe(0.47);
    expect(sim.shared[0]![1]).toBe(3);
  });

  it("returns an empty matrix for no players", () => {
    const sim = computePickSimilarity([], matches, []);
    expect(sim.players).toEqual([]);
    expect(sim.matrix).toEqual([]);
  });

  it("only counts matches both players predicted", () => {
    // Only m1 is shared (both 1-0) → similarity 1.0 over the single match.
    const sim = computePickSimilarity(
      [A, B],
      matches,
      [
        pred("a", "m1", 1, 0),
        pred("a", "m2", 2, 1),
        pred("b", "m1", 1, 0),
        pred("b", "m3", 0, 1),
      ]
    );
    expect(sim.matrix[0]![1]).toBe(1);
    expect(sim.shared[0]![1]).toBe(1);
  });

  it("returns null when a pair shares no match", () => {
    const sim = computePickSimilarity(
      [A, B],
      matches,
      [pred("a", "m1", 1, 0), pred("b", "m2", 0, 1)]
    );
    expect(sim.matrix[0]![1]).toBeNull();
    expect(sim.shared[0]![1]).toBe(0);
  });

  it("ignores predictions for matches out of scope", () => {
    const sim = computePickSimilarity(
      [A, B],
      [M1],
      [
        pred("a", "m1", 1, 0),
        pred("b", "m1", 1, 0),
        pred("a", "other", 5, 5),
        pred("b", "other", 5, 5),
      ]
    );
    expect(sim.shared[0]![1]).toBe(1);
  });
});

describe("computePickSimilarity — knockout core", () => {
  it("scores identical knockout picks at 1.0 (advance excluded)", () => {
    const ko: SimMatch = { id: "k1", stage: "knockout" };
    const sim = computePickSimilarity(
      [A, B],
      [ko],
      [pred("a", "k1", 2, 1), pred("b", "k1", 2, 1)]
    );
    expect(sim.matrix[0]![1]).toBe(1);
  });
});

describe("computePickSimilarity — three players", () => {
  it("produces a symmetric 3×3 matrix", () => {
    const sim = computePickSimilarity(
      [A, B, C],
      [M1],
      [pred("a", "m1", 1, 0), pred("b", "m1", 2, 0), pred("c", "m1", 0, 1)]
    );
    expect(sim.matrix.length).toBe(3);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(sim.matrix[i]![j]).toBe(sim.matrix[j]![i]);
  });
});

describe("selectNeighbours", () => {
  const ranked: RankedPlayer[] = Array.from({ length: 10 }, (_, i) => ({
    userId: `u${i + 1}`,
    displayName: `P${i + 1}`,
    rank: i + 1,
  }));

  it("returns everyone when fewer players than the window", () => {
    const small = ranked.slice(0, 5);
    expect(selectNeighbours(small, "u3", 8)).toHaveLength(5);
  });

  it("centers the window on a mid-ranked selection", () => {
    const out = selectNeighbours(ranked, "u6", 8);
    expect(out).toHaveLength(8);
    expect(out.map((p) => p.userId)).toContain("u6");
  });

  it("slides the window at the top edge", () => {
    const out = selectNeighbours(ranked, "u1", 8);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("slides the window at the bottom edge", () => {
    const out = selectNeighbours(ranked, "u10", 8);
    expect(out.map((p) => p.rank)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("falls back to the top N when the selection is missing", () => {
    const out = selectNeighbours(ranked, "nope", 8);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("orders by rank then userId for determinism on ties", () => {
    const tied: RankedPlayer[] = [
      { userId: "z", displayName: "Z", rank: 1 },
      { userId: "a", displayName: "A", rank: 1 },
    ];
    expect(selectNeighbours(tied, "z", 8).map((p) => p.userId)).toEqual([
      "a",
      "z",
    ]);
  });
});
