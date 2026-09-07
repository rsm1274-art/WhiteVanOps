import { describe, it, expect } from "vitest";
import {
  formatQuoteNumber,
  computeQuoteTotal,
  deriveQuoteStatus,
  canEditQuote,
  canDeleteQuote,
  canConvertQuote,
  canRespondToQuote,
  buildQuoteApprovalUrl,
  QuoteStatus,
} from "./quote";

const PAST = new Date("2026-01-01T12:00:00Z");
const FUTURE = new Date("2099-01-01T12:00:00Z");
const NOW = new Date("2026-06-01T12:00:00Z");

describe("formatQuoteNumber", () => {
  it("zero-pads to four digits", () => {
    expect(formatQuoteNumber(1)).toBe("QTE-0001");
    expect(formatQuoteNumber(42)).toBe("QTE-0042");
  });

  it("does not truncate past four digits", () => {
    expect(formatQuoteNumber(12345)).toBe("QTE-12345");
  });
});

describe("computeQuoteTotal", () => {
  it("multiplies quantity by rate across every line", () => {
    expect(computeQuoteTotal([{ quantity: 2, rate: 50 }, { quantity: 3, rate: 10 }])).toBe(130);
  });

  it("returns zero for an empty quote", () => {
    expect(computeQuoteTotal([])).toBe(0);
  });
});

describe("deriveQuoteStatus", () => {
  it("expires a Sent quote once its expiry date has passed", () => {
    expect(deriveQuoteStatus("Sent", PAST, NOW)).toBe("Expired");
  });

  it("leaves a Sent quote alone while it is still in date", () => {
    expect(deriveQuoteStatus("Sent", FUTURE, NOW)).toBe("Sent");
  });

  it("never expires a Draft, which the customer has not seen", () => {
    expect(deriveQuoteStatus("Draft", PAST, NOW)).toBe("Draft");
  });

  it("never rewrites a decision that has already been taken", () => {
    const decided: QuoteStatus[] = ["Approved", "Declined", "Converted"];
    for (const status of decided) {
      expect(deriveQuoteStatus(status, PAST, NOW)).toBe(status);
    }
  });
});

describe("canEditQuote / canDeleteQuote", () => {
  it("allows both only on a Draft", () => {
    expect(canEditQuote("Draft")).toBe(true);
    expect(canDeleteQuote("Draft")).toBe(true);
  });

  it("refuses both on anything already issued", () => {
    const issued: QuoteStatus[] = ["Sent", "Approved", "Declined", "Expired", "Converted"];
    for (const status of issued) {
      expect(canEditQuote(status)).toBe(false);
      expect(canDeleteQuote(status)).toBe(false);
    }
  });
});

describe("canConvertQuote", () => {
  it("allows conversion only from Approved", () => {
    expect(canConvertQuote("Approved")).toBe(true);
  });

  it("refuses a quote the customer has not accepted, and refuses a second conversion", () => {
    const refused: QuoteStatus[] = ["Draft", "Sent", "Declined", "Expired", "Converted"];
    for (const status of refused) {
      expect(canConvertQuote(status)).toBe(false);
    }
  });
});

describe("canRespondToQuote", () => {
  it("accepts a response on a live Sent quote", () => {
    expect(canRespondToQuote("Sent", FUTURE, NOW)).toEqual({ ok: true });
  });

  it("refuses a response on a quote that was never issued", () => {
    const result = canRespondToQuote("Draft", FUTURE, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not been issued/);
  });

  it("refuses a second response once the customer has already accepted", () => {
    for (const status of ["Approved", "Converted"] as QuoteStatus[]) {
      const result = canRespondToQuote(status, FUTURE, NOW);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/already been accepted/);
    }
  });

  it("refuses a second response once the customer has already declined", () => {
    const result = canRespondToQuote("Declined", FUTURE, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already been declined/);
  });

  it("refuses a response after the expiry date, so stale pricing cannot be locked in", () => {
    const result = canRespondToQuote("Sent", PAST, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it("gives the customer no detail about internal state in any refusal", () => {
    const statuses: QuoteStatus[] = ["Draft", "Approved", "Declined", "Converted"];
    for (const status of statuses) {
      const { reason } = canRespondToQuote(status, PAST, NOW);
      expect(reason).toBeDefined();
      expect(reason!.toLowerCase()).not.toContain("draft");
      expect(reason!.toLowerCase()).not.toContain("converted");
    }
  });
});

describe("buildQuoteApprovalUrl", () => {
  const TOKEN = "abc123";

  it("borrows the origin of the configured field-access URL, dropping its path", () => {
    expect(buildQuoteApprovalUrl("https://vans.example.com/field", "http://localhost:3000", TOKEN)).toBe(
      "https://vans.example.com/quote/abc123"
    );
  });

  it("falls back to the request origin when field access is unconfigured", () => {
    expect(buildQuoteApprovalUrl(null, "http://localhost:3000", TOKEN)).toBe("http://localhost:3000/quote/abc123");
  });

  it("falls back to the request origin rather than emitting a broken link for a malformed setting", () => {
    expect(buildQuoteApprovalUrl("not a url", "http://localhost:3000", TOKEN)).toBe(
      "http://localhost:3000/quote/abc123"
    );
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(buildQuoteApprovalUrl(null, "http://localhost:3000/", TOKEN)).toBe("http://localhost:3000/quote/abc123");
  });
});
