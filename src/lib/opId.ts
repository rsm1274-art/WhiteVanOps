/**
 * ULID-shaped operation ids for the offline sync queue.
 *
 * 26-character Crockford base32 string: 48-bit big-endian millisecond
 * timestamp (10 chars) followed by 80 bits of randomness (16 chars). Two ids
 * generated with strictly increasing clock values sort lexicographically in
 * the same order as the clock — that property is what opOrdering.ts's
 * last-write-wins logic depends on.
 *
 * Deliberately NOT crypto.randomUUID(): it requires a secure context
 * (HTTPS/localhost) and this code runs on a plain-http LAN origin in
 * production (see CLAUDE.md's per-plan transport section), where it is
 * undefined. crypto.getRandomValues() has no such restriction. clock and
 * randomBytes are injectable so this is testable without a browser crypto
 * API — a test can pass a deterministic fake for either.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I/L/O/U

function defaultRandomBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(10));
}

export function generateOpId(
  clock: () => number = Date.now,
  randomBytes: () => Uint8Array = defaultRandomBytes
): string {
  const time = clock();

  // 48-bit timestamp -> 10 Crockford base32 characters.
  let timeChars = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeChars = ENCODING[t % 32] + timeChars;
    t = Math.floor(t / 32);
  }

  // 80 bits (10 bytes) of randomness -> 16 Crockford base32 characters.
  const bytes = randomBytes();
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let randomChars = "";
  for (let i = 0; i < 16; i++) {
    const chunk = bits.slice(i * 5, i * 5 + 5);
    randomChars += ENCODING[parseInt(chunk, 2)];
  }

  return timeChars + randomChars;
}
