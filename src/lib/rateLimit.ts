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
