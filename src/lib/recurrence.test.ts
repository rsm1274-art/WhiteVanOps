import { describe, it, expect } from "vitest";
import { nextOccurrence } from "./recurrence";

describe("nextOccurrence", () => {
  it("advances Weekly by 7 days", () => {
    const result = nextOccurrence(new Date(2026, 5, 1), "Weekly");
    expect(result).toEqual(new Date(2026, 5, 8));
  });

  it("advances Biweekly by 14 days", () => {
    const result = nextOccurrence(new Date(2026, 5, 1), "Biweekly");
    expect(result).toEqual(new Date(2026, 5, 15));
  });

  it("advances Monthly by one calendar month on a normal day-of-month", () => {
    const result = nextOccurrence(new Date(2026, 5, 15), "Monthly");
    expect(result).toEqual(new Date(2026, 6, 15));
  });

  it("rolls Monthly into the next month when the day doesn't exist (Jan 31 -> Mar 3, documented caveat)", () => {
    const result = nextOccurrence(new Date(2026, 0, 31), "Monthly");
    // February 2026 has 28 days, so JS Date's setMonth overflow rolls this to March 3.
    expect(result).toEqual(new Date(2026, 2, 3));
  });

  it("does not mutate the input date", () => {
    const input = new Date(2026, 5, 1);
    const originalTime = input.getTime();
    nextOccurrence(input, "Weekly");
    expect(input.getTime()).toBe(originalTime);
  });
});
