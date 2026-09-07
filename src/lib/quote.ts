// Pure quote math/status logic, shared by the quote API routes, the Quotes tab
// and unit tests. No DB imports — keep this module side-effect free.
//
// It must also stay free of Node built-ins: the client-side Quotes tab imports
// it, and a bare `crypto` import here would break the browser bundle. Token
// minting therefore lives in the server-only src/lib/quoteToken.ts.
//
// Mirrors src/lib/invoice.ts, the same idea for the post-sale half of the loop.

export type QuoteStatus = "Draft" | "Sent" | "Approved" | "Declined" | "Expired" | "Converted";

export const QUOTE_NUMBER_SETTING_KEY = "quote_next_number";

export function formatQuoteNumber(n: number): string {
  return `QTE-${String(n).padStart(4, "0")}`;
}

export function computeQuoteTotal(lineItems: { quantity: number; rate: number }[]): number {
  return lineItems.reduce((sum, li) => sum + li.quantity * li.rate, 0);
}

/**
 * Effective status for display. Only a Sent quote can lapse into Expired: a
 * Draft was never the customer's to see, and Approved / Declined / Converted
 * are decisions already taken and must not be rewritten by the clock.
 *
 * Expiry is stored as local noon (see dateUtils), so a quote stays live for the
 * whole of its expiry date rather than dying at midnight.
 */
export function deriveQuoteStatus(currentStatus: QuoteStatus, expiryDate: Date, now: Date = new Date()): QuoteStatus {
  if (currentStatus !== "Sent") return currentStatus;
  return now.getTime() > expiryDate.getTime() ? "Expired" : "Sent";
}

/** Only an untouched Draft may be edited or deleted; anything sent is a record. */
export function canEditQuote(status: QuoteStatus): boolean {
  return status === "Draft";
}

export function canDeleteQuote(status: QuoteStatus): boolean {
  return status === "Draft";
}

/** A quote becomes an invoice exactly once, and only after the customer said yes. */
export function canConvertQuote(status: QuoteStatus): boolean {
  return status === "Approved";
}

export interface RespondCheck {
  ok: boolean;
  /** Customer-safe explanation. Deliberately vague about internal state. */
  reason?: string;
}

/**
 * Whether a customer may still approve or decline. Called by both the public
 * route and the dashboard's manual record-a-decision path, so the two can't
 * drift on what counts as still-open.
 */
export function canRespondToQuote(status: QuoteStatus, expiryDate: Date, now: Date = new Date()): RespondCheck {
  if (status === "Draft") return { ok: false, reason: "This quote has not been issued yet." };
  if (status === "Approved" || status === "Converted") return { ok: false, reason: "This quote has already been accepted." };
  if (status === "Declined") return { ok: false, reason: "This quote has already been declined." };
  if (deriveQuoteStatus(status, expiryDate, now) === "Expired") {
    return { ok: false, reason: "This quote has expired. Please contact us for an updated price." };
  }
  return { ok: true };
}

/** Path of the customer-facing approval page for a given token. */
export function quoteApprovalPath(token: string): string {
  return `/quote/${token}`;
}

/**
 * Absolute link to send a customer.
 *
 * The dashboard is normally opened at http://localhost:3000, so the request's
 * own origin is useless in a customer email. The address that actually reaches
 * this server from outside is the one the operator already configured for field
 * access (SystemSetting "field_access_url", e.g. a Plus tunnel hostname), so we
 * borrow its origin and fall back to the request origin only when unset.
 */
export function buildQuoteApprovalUrl(
  fieldAccessUrl: string | null | undefined,
  requestOrigin: string,
  token: string
): string {
  let base = requestOrigin;
  if (fieldAccessUrl) {
    try {
      base = new URL(fieldAccessUrl).origin;
    } catch {
      // Malformed setting — keep the request origin rather than emitting a
      // broken link.
    }
  }
  return `${base.replace(/\/+$/, "")}${quoteApprovalPath(token)}`;
}
