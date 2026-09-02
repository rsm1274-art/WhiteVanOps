import { describe, it, expect } from "vitest";
import { parseCount, collectChangedAdjustments, normalizeAdjustments } from "./stockAdjust";

describe("parseCount", () => {
  it("accepts non-negative whole numbers written as strings", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount("15")).toBe(15);
    expect(parseCount("  7 ")).toBe(7);
  });

  it("accepts non-negative whole numbers written as numbers", () => {
    expect(parseCount(0)).toBe(0);
    expect(parseCount(42)).toBe(42);
  });

  it("rejects blanks, negatives, decimals and non-numeric text", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("   ")).toBeNull();
    expect(parseCount("-1")).toBeNull();
    expect(parseCount("2.5")).toBeNull();
    expect(parseCount("12abc")).toBeNull();
    expect(parseCount(-3)).toBeNull();
    expect(parseCount(1.5)).toBeNull();
    expect(parseCount(NaN)).toBeNull();
    expect(parseCount(null)).toBeNull();
    expect(parseCount(undefined)).toBeNull();
  });
});

describe("collectChangedAdjustments", () => {
  it("returns only the locations whose quantity or minimum actually changed", () => {
    const result = collectChangedAdjustments(
      {
        warehouse: { quantity: 10, minThreshold: 2 },
        van1: { quantity: 4, minThreshold: 1 },
        van2: { quantity: 0, minThreshold: 0 },
      },
      {
        warehouse: { quantity: "12", minThreshold: "2" },
        van1: { quantity: "4", minThreshold: "1" },
        van2: { quantity: "0", minThreshold: "3" },
      },
    );

    expect(result).toEqual({
      ok: true,
      adjustments: [
        { stockLocationId: "warehouse", quantity: 12, minThreshold: 2 },
        { stockLocationId: "van2", quantity: 0, minThreshold: 3 },
      ],
    });
  });

  it("treats a location with no existing stock level as zero on hand", () => {
    const result = collectChangedAdjustments(
      {},
      { van3: { quantity: "6", minThreshold: "0" } },
    );

    expect(result).toEqual({
      ok: true,
      adjustments: [{ stockLocationId: "van3", quantity: 6, minThreshold: 0 }],
    });
  });

  it("returns no adjustments when nothing was edited", () => {
    const result = collectChangedAdjustments(
      { warehouse: { quantity: 10, minThreshold: 2 } },
      { warehouse: { quantity: "10", minThreshold: "2" } },
    );

    expect(result).toEqual({ ok: true, adjustments: [] });
  });

  it("reports every invalid location at once rather than stopping at the first", () => {
    const result = collectChangedAdjustments(
      {},
      {
        warehouse: { quantity: "-1", minThreshold: "0" },
        van1: { quantity: "3", minThreshold: "0" },
        van2: { quantity: "", minThreshold: "0" },
      },
    );

    expect(result).toEqual({ ok: false, invalidLocationIds: ["warehouse", "van2"] });
  });
});

describe("normalizeAdjustments", () => {
  it("normalizes a well-formed payload", () => {
    const result = normalizeAdjustments([
      { stockLocationId: "warehouse", quantity: "12", minThreshold: "2" },
      { stockLocationId: "van1", quantity: 0, minThreshold: 0 },
    ]);

    expect(result).toEqual({
      ok: true,
      adjustments: [
        { stockLocationId: "warehouse", quantity: 12, minThreshold: 2 },
        { stockLocationId: "van1", quantity: 0, minThreshold: 0 },
      ],
    });
  });

  it("rejects a non-array or empty payload", () => {
    expect(normalizeAdjustments(undefined).ok).toBe(false);
    expect(normalizeAdjustments("nope").ok).toBe(false);
    expect(normalizeAdjustments([]).ok).toBe(false);
  });

  it("rejects entries with a missing or blank location id", () => {
    expect(normalizeAdjustments([{ quantity: 1, minThreshold: 0 }]).ok).toBe(false);
    expect(
      normalizeAdjustments([{ stockLocationId: "  ", quantity: 1, minThreshold: 0 }]).ok,
    ).toBe(false);
  });

  it("rejects a duplicated location so two rows cannot race on one stock level", () => {
    const result = normalizeAdjustments([
      { stockLocationId: "warehouse", quantity: 1, minThreshold: 0 },
      { stockLocationId: "warehouse", quantity: 9, minThreshold: 0 },
    ]);

    expect(result).toEqual({ ok: false, error: "The same location appears twice in one adjustment" });
  });

  it("rejects negative or fractional counts before any write is attempted", () => {
    expect(
      normalizeAdjustments([{ stockLocationId: "warehouse", quantity: -5, minThreshold: 0 }]).ok,
    ).toBe(false);
    expect(
      normalizeAdjustments([{ stockLocationId: "warehouse", quantity: 3, minThreshold: 1.5 }]).ok,
    ).toBe(false);
  });
});
