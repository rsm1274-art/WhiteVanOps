import { describe, it, expect } from "vitest";
import { generateQuoteToken } from "./quoteToken";

describe("generateQuoteToken", () => {
  it("returns a URL-safe string with no padding or reserved characters", () => {
    expect(generateQuoteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns at least 256 bits of entropy", () => {
    // 32 raw bytes encode to 43 base64url characters.
    expect(generateQuoteToken().length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat across calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateQuoteToken()));
    expect(tokens.size).toBe(100);
  });
});
