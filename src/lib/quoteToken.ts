// Server-only. Split out of src/lib/quote.ts so that module can stay importable
// from the client-side Quotes tab — a bare Node `crypto` import there would
// break the browser bundle.

import { randomBytes } from "crypto";

/** Bytes of entropy in a public approval token. 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

/**
 * Mints the secret in a quote's public approval URL. This is the only thing
 * standing between the open internet and a customer's pricing, so it must be
 * unguessable rather than merely unique — a cuid or a sequential number would
 * let anyone walk the list. base64url keeps it URL-safe with no escaping.
 */
export function generateQuoteToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
