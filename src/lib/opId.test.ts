import { describe, test, expect } from "vitest";
import { generateOpId } from "@/lib/opId";

describe("generateOpId", () => {
  test("produces a 26-character Crockford base32 string", () => {
    const id = generateOpId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("never contains I, L, O, or U", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateOpId();
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  test("is unique across many calls with real randomness", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      ids.add(generateOpId());
    }
    expect(ids.size).toBe(5000);
  });

  test("sorts lexicographically in the same order as a strictly increasing clock", () => {
    let t = 1_700_000_000_000;
    const clock = () => t;
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(generateOpId(clock));
      t += 1; // strictly increasing
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  test("sorts correctly even when timestamps jump by large gaps", () => {
    const clocks = [1_600_000_000_000, 1_650_000_000_000, 1_700_000_000_000, 1_750_000_000_000];
    const ids = clocks.map((t) => generateOpId(() => t));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  test("uses the injected randomBytes source and default clock/randomBytes when omitted", () => {
    const fixedBytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const id = generateOpId(() => 0, () => fixedBytes);
    // Timestamp 0 -> 10 zero chars; all-zero random bytes -> 16 zero chars.
    expect(id).toBe("00000000000000000000000000".slice(0, 26));
  });

  test("respects an explicit clock while still generating real randomness by default", () => {
    const id1 = generateOpId(() => 12345);
    const id2 = generateOpId(() => 12345);
    // Same timestamp component, but random suffix should (almost certainly) differ.
    expect(id1.slice(0, 10)).toBe(id2.slice(0, 10));
    expect(id1).not.toBe(id2);
  });
});
