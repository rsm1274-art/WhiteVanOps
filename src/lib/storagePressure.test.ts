import { describe, test, expect } from "vitest";
import { shouldWarnAboutStorage, PENDING_COUNT_FALLBACK_THRESHOLD } from "@/lib/storagePressure";

describe("shouldWarnAboutStorage", () => {
  test("warns when usage/quota exceeds ~80%", () => {
    expect(shouldWarnAboutStorage({ usage: 81, quota: 100 }, 0)).toBe(true);
  });

  test("does not warn when usage/quota is comfortably under 80%", () => {
    expect(shouldWarnAboutStorage({ usage: 50, quota: 100 }, 0)).toBe(false);
  });

  test("does not warn right at the boundary (80% exactly)", () => {
    expect(shouldWarnAboutStorage({ usage: 80, quota: 100 }, 0)).toBe(false);
  });

  test("falls back to the queue-depth threshold when the estimate is unavailable", () => {
    expect(shouldWarnAboutStorage(null, PENDING_COUNT_FALLBACK_THRESHOLD + 1)).toBe(true);
    expect(shouldWarnAboutStorage(null, PENDING_COUNT_FALLBACK_THRESHOLD)).toBe(false);
  });

  test("a normal day's work (a handful of jobs, a few ops each) does not trigger the fallback", () => {
    expect(shouldWarnAboutStorage(null, 10)).toBe(false);
  });

  test("falls back to queue depth when quota is reported as zero", () => {
    expect(shouldWarnAboutStorage({ usage: 0, quota: 0 }, PENDING_COUNT_FALLBACK_THRESHOLD + 1)).toBe(true);
  });
});
