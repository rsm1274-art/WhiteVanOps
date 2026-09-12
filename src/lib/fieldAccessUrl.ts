export interface FieldUrlClassification {
  /** Host is localhost / 127.0.0.1 — unreachable from a phone. */
  isLocalhost: boolean;
  /** RFC1918 address or *.local name — the office LAN, the only transport the field module uses. */
  isPrivateLan: boolean;
}

/**
 * The three ways a Field Module URL can relate to the (only) transport
 * WhiteVanOps v2.0 supports: the office LAN. There is no tier and no tunnel —
 * every install syncs the field module over WiFi only. A code, not a
 * sentence: the decision table stays unit-testable here and the user-facing
 * copy stays in FieldAccessModal.
 */
export type FieldUrlVerdict = "localhost" | "ok-lan" | "not-lan";

function hostOf(url: string): string {
  // Hand-rolled rather than `new URL()`: this runs against a half-typed value
  // from a controlled input, and `new URL("http://19")` throwing mid-keystroke
  // would break the live classification.
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : "";
}

function isPrivateLanHost(host: string): boolean {
  if (host.endsWith(".local")) return true;

  const octets = host.split(".");
  if (octets.length !== 4) return false;
  const nums = octets.map((o) => Number(o));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  // 172.16.0.0/12 is 172.16 through 172.31 inclusive — NOT all of 172.x.
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Classifies a Field Module URL by transport shape so the QR flow can guide
 * the admin. The field module is served over the office LAN only, so a
 * private address is the correct configuration; localhost is never
 * phone-reachable.
 */
export function classifyFieldUrl(url: string): FieldUrlClassification {
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isPrivateLan = !isLocalhost && isPrivateLanHost(hostOf(url));
  return { isLocalhost, isPrivateLan };
}

/**
 * Maps a URL onto the advice the admin needs. There is no remote transport in
 * v2.0 — sync is office WiFi only — so anything that isn't localhost or a
 * private-LAN address simply cannot reach the field module.
 */
export function fieldUrlVerdict(url: string): FieldUrlVerdict {
  const { isLocalhost, isPrivateLan } = classifyFieldUrl(url);
  if (isLocalhost) return "localhost";
  if (isPrivateLan) return "ok-lan";
  return "not-lan";
}
