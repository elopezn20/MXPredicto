import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("true is true", () => {
    expect(true).toBe(true);
  });

  it("scoring module placeholder exists", async () => {
    // Phase 2 will add real scoring tests
    expect(1 + 1).toBe(2);
  });
});
