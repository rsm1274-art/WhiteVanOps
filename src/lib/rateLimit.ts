// In-memory sliding-window rate limiter, keyed by an arbitrary string (e.g. client IP).
// This app runs as a single Node process (Electron-bundled or PM2-managed, per
// CLAUDE.md), so an in-memory store is sufficient — it isn't shared across
// instances, but there is only ever one. Counters reset on process restart,
// which is an acceptable tradeoff for slowing down brute-force login attempts.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Returns true if `key` is currently within its allowed request budget
 * (and records this call as one use of that budget). Returns false if the
 * caller has exceeded `maxRequests` within the last `windowMs`.
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= maxRequests) {
    return false;
  }

  bucket.count += 1;
  return true;
}

/** Drops every bucket. Exported for tests, which need a clean slate per case. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort real client address, or null when it genuinely can't be determined.
 *
 * Deliberately returns null instead of a placeholder like "unknown": a constant
 * fallback collapses every unidentifiable caller into ONE bucket, so a single
 * misconfigured proxy would have the whole company sharing one login budget.
 */
export function getClientIp(req: Request): string | null {
  // Cloudflare Tunnel sets this to the real client address and, unlike
  // X-Forwarded-For, a client can't prepend a spoofed entry to it.
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0],
    req.headers.get("x-real-ip"),
  ];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip) return ip;
  }
  return null;
}

// Layered login limits. The real brute-force control is the DB-persisted
// per-account lockout in the login route (5 attempts / 15 min, survives
// restarts); these two are the in-memory layers around it.
//
// Per (ip, username): stops one source hammering one account.
export const LOGIN_IDENTITY_MAX_ATTEMPTS = 20;
const LOGIN_IDENTITY_WINDOW_MS = 5 * 60 * 1000;
// Per IP: a deliberately generous ceiling against credential stuffing across
// many usernames. It must stay well clear of legitimate traffic, because the
// office LAN and mobile-carrier CGNAT both put every tech behind one address —
// too tight a ceiling and they lock each other out.
export const LOGIN_IP_CEILING_MAX_ATTEMPTS = 100;
const LOGIN_IP_CEILING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Returns true if this login attempt is within budget. `ip` may be null (see
 * getClientIp) — the attempt then falls back to a per-username bucket rather
 * than any shared one.
 */
export function checkLoginRateLimit(ip: string | null, username: string): boolean {
  const identity = `${ip ?? "no-ip"}|${username.trim().toLowerCase()}`;
  if (!checkRateLimit(`login:id:${identity}`, LOGIN_IDENTITY_MAX_ATTEMPTS, LOGIN_IDENTITY_WINDOW_MS)) {
    return false;
  }
  if (ip && !checkRateLimit(`login:ip:${ip}`, LOGIN_IP_CEILING_MAX_ATTEMPTS, LOGIN_IP_CEILING_WINDOW_MS)) {
    return false;
  }
  return true;
}

// Periodically drop stale buckets so this map doesn't grow unbounded on a
// long-running server. Not critical for correctness, just memory hygiene.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > 30 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();
