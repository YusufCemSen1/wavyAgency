import { describe, expect, it } from "vitest";

import { committableCents, grossEarningsCents, remainingBudgetCents } from "@/lib/money";

/**
 * The payout formula is the one number a creator gets paid on, so it gets
 * tested directly rather than only through the database.
 */
describe("grossEarningsCents", () => {
  it("pays per completed thousand views only", () => {
    expect(grossEarningsCents(0, 250)).toBe(0);
    expect(grossEarningsCents(999, 250)).toBe(0);
    expect(grossEarningsCents(1_000, 250)).toBe(250);
    expect(grossEarningsCents(1_999, 250)).toBe(250);
    expect(grossEarningsCents(2_000, 250)).toBe(500);
  });

  it("stays exact on values that would drift in floating point", () => {
    // 0.1 + 0.2 territory: everything is integer cents, so this is exact.
    expect(grossEarningsCents(3_000, 10)).toBe(30);
    expect(grossEarningsCents(1_234_567, 7)).toBe(1234 * 7);
  });

  it("rejects nonsense inputs rather than returning NaN", () => {
    expect(() => grossEarningsCents(Number.NaN, 100)).toThrow(TypeError);
    expect(() => grossEarningsCents(-1, 100)).toThrow(RangeError);
  });
});

describe("budget helpers", () => {
  it("never reports a negative remaining budget", () => {
    expect(remainingBudgetCents(1_000, 1_200)).toBe(0);
    expect(remainingBudgetCents(1_000, 400)).toBe(600);
  });

  it("clips what can be committed to what is left", () => {
    expect(committableCents(500, 1_000, 0)).toBe(500);
    expect(committableCents(500, 1_000, 800)).toBe(200);
    expect(committableCents(500, 1_000, 1_000)).toBe(0);
    expect(committableCents(-50, 1_000, 0)).toBe(0);
  });
});
