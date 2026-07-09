// Pure invoice math/status logic, shared by the invoice API routes and unit
// tests. No DB imports — keep this module side-effect free.

export type InvoiceStatus = "Draft" | "Sent" | "PartiallyPaid" | "Paid" | "Void";

export const INVOICE_NUMBER_SETTING_KEY = "invoice_next_number";

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

export function computeInvoiceTotal(lineItems: { quantity: number; rate: number }[]): number {
  return lineItems.reduce((sum, li) => sum + li.quantity * li.rate, 0);
}

export function computePaidTotal(payments: { amount: number }[]): number {
  return payments.reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Derives the payment-driven status. Void is terminal and never overridden;
 * an unpaid invoice keeps its manual Draft/Sent state. Uses a small epsilon
 * so float line-item math doesn't strand a fully-paid invoice at
 * PartiallyPaid.
 */
export function deriveInvoiceStatus(
  currentStatus: InvoiceStatus,
  total: number,
  paid: number
): InvoiceStatus {
  if (currentStatus === "Void") return "Void";
  if (paid >= total - 0.005 && total > 0) return "Paid";
  if (paid > 0) return "PartiallyPaid";
  return currentStatus === "PartiallyPaid" || currentStatus === "Paid" ? "Sent" : currentStatus;
}
