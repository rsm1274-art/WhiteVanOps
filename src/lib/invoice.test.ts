import { describe, it, expect } from "vitest";
import {
  formatInvoiceNumber,
  computeInvoiceTotal,
  computePaidTotal,
  deriveInvoiceStatus,
} from "./invoice";

describe("formatInvoiceNumber", () => {
  it("zero-pads to four digits", () => {
    expect(formatInvoiceNumber(1)).toBe("INV-0001");
    expect(formatInvoiceNumber(42)).toBe("INV-0042");
  });

  it("does not truncate past four digits", () => {
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });
});

describe("computeInvoiceTotal / computePaidTotal", () => {
  it("sums quantity * rate across line items", () => {
    expect(
      computeInvoiceTotal([
        { quantity: 2, rate: 50 },
        { quantity: 1.5, rate: 100 },
      ])
    ).toBe(250);
  });

  it("sums payment amounts", () => {
    expect(computePaidTotal([{ amount: 100 }, { amount: 50.5 }])).toBe(150.5);
  });

  it("returns 0 for empty lists", () => {
    expect(computeInvoiceTotal([])).toBe(0);
    expect(computePaidTotal([])).toBe(0);
  });
});

describe("deriveInvoiceStatus", () => {
  it("keeps Draft/Sent when nothing is paid", () => {
    expect(deriveInvoiceStatus("Draft", 100, 0)).toBe("Draft");
    expect(deriveInvoiceStatus("Sent", 100, 0)).toBe("Sent");
  });

  it("moves to PartiallyPaid on a partial payment", () => {
    expect(deriveInvoiceStatus("Sent", 100, 40)).toBe("PartiallyPaid");
  });

  it("moves to Paid when the balance is covered", () => {
    expect(deriveInvoiceStatus("Sent", 100, 100)).toBe("Paid");
    expect(deriveInvoiceStatus("PartiallyPaid", 100, 100)).toBe("Paid");
  });

  it("treats float dust within a cent as fully paid", () => {
    expect(deriveInvoiceStatus("Sent", 0.1 + 0.2, 0.3)).toBe("Paid");
  });

  it("never resurrects a Void invoice", () => {
    expect(deriveInvoiceStatus("Void", 100, 100)).toBe("Void");
  });

  it("does not mark a zero-total invoice Paid with no payments", () => {
    expect(deriveInvoiceStatus("Sent", 0, 0)).toBe("Sent");
  });
});
