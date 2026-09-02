export interface FieldUrlClassification {
  /** Host is localhost / 127.0.0.1 — unreachable from a phone. */
  isLocalhost: boolean;
  /** Plain http:// on any non-localhost host — includes private-LAN addresses, which are fine on Base; use fieldUrlVerdict for advice. */
  isPlainHttp: boolean;
  /** https:// — the shape the Plus tunnel produces. */
  isHttps: boolean;
  /** RFC1918 address or *.local name — the office LAN, i.e. Base's transport. */
  isPrivateLan: boolean;
}

/**
 * The five ways a Field Module URL can relate to the licensed transport.
 * A code, not a sentence: the decision table stays unit-testable here and the
 * user-facing copy stays in FieldAccessModal.
 */
export type FieldUrlVerdict =
  | "ok-lan"
  | "ok-tunnel"
  | "localhost"
  | "remote-needs-plus"
  | "public-plain-http";

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
 * the admin. Base serves the field module over the office LAN, so a private
 * address is the correct configuration there; Plus adds an HTTPS tunnel
 * hostname. localhost is never phone-reachable on either plan.
 */
export function classifyFieldUrl(url: string): FieldUrlClassification {
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isHttps = /^https:\/\//i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;
  const isPrivateLan = !isLocalhost && isPrivateLanHost(hostOf(url));
  return { isLocalhost, isPlainHttp, isHttps, isPrivateLan };
}

/**
 * Maps a URL plus the remote-access entitlement onto the advice the admin
 * needs. `remoteLicensed` is Plus: only Plus installs ship cloudflared, so a
 * public hostname on Base cannot reach the office server at all.
 */
export function fieldUrlVerdict(url: string, remoteLicensed: boolean): FieldUrlVerdict {
  const { isLocalhost, isPrivateLan, isHttps } = classifyFieldUrl(url);
  if (isLocalhost) return "localhost";
  if (isPrivateLan) return "ok-lan";
  if (!remoteLicensed) return "remote-needs-plus";
  return isHttps ? "ok-tunnel" : "public-plain-http";
}
