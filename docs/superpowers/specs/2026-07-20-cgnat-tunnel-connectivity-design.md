# Connectivity & Stability: Cloudflare Tunnel as the Default Field-Access Path

**Date:** 2026-07-20
**Status:** Design approved, pending implementation plan
**Supersedes:** Port Forwarding + Dynamic DNS (`MANUAL_Setup_Installation.md` §7, `launch-checklist.md` Phase 4)

## Problem

The documented field-access architecture is router port forwarding + Dynamic DNS
(`http://<client>.duckdns.org:3000/field`). It has three defects that are now blocking:

1. **CGNAT makes it impossible.** Behind Carrier-Grade NAT there is no inbound path —
   no router setting fixes it. `MANUAL_White_Glove_Installation.md` Phase B currently
   *dead-ends* on this ("don't proceed until confirmed"), meaning some share of future
   customers simply cannot be installed. CGNAT is expanding (IPv4 exhaustion; common on
   cable, fixed-wireless, rural, and mobile-carrier home internet).
2. **"Call the ISP for a static IP" is not a repeatable install step.** It depends on
   per-customer negotiation with an unrelated third party and may cost money or be flatly
   unavailable. A product cannot ship an install path that might not exist.
3. **It is plain HTTP.** Credentials and session cookies traverse the public internet
   unencrypted — a knowingly accepted tradeoff, but a real one.

## Decision

Adopt **Cloudflare Tunnel as the default field-access path for all installs**, replacing
port forwarding + DDNS. Vendor owns one domain in a single Cloudflare account (free plan);
each customer gets a subdomain served by a per-customer named tunnel.

### Why this option

- **$0 marginal cost per customer.** ~$10–15/yr for one domain, flat, regardless of
  customer count. Tunnels are free and unlimited; public-hostname tunnels consume no Zero
  Trust seats. This is the decisive property given there is **no subscription revenue** —
  any per-customer cost would be a permanent unfunded liability.
- **CGNAT-proof by construction.** `cloudflared` makes an outbound-only connection; no
  inbound port, no public IP, no ISP negotiation. Works on every customer's network.
- **Removes attack surface.** No forwarded inbound port on the customer's router at all —
  strictly better than the port-forward model it replaces.
- **Terminates real HTTPS**, closing the plaintext-credentials hole and making PWA service
  workers function (they require a secure context and are effectively broken today).
- **Near-zero ops.** Cloudflare operates the hard part. In a no-subscription model the
  dominant cost is vendor support time, not money — this minimizes it.

### Options rejected

- **Paid Cloudflare tier** — does not increase tunnel throughput or stability; those are
  not gated by plan. Only Business (~$200/mo) adds an uptime SLA, unjustifiable here.
  Start on Free; revisit only against a named, experienced pain.
- **Vendor VPS + WireGuard/frp + Caddy** — ~$60/yr is affordable, but the vendor becomes
  responsible for patching, monitoring, uptime, and incident response across the whole
  customer base. That time cost is the expensive part and it grows with customers.
- **Tailscale / Funnel** — free tier is Personal, not licensed for commercial use;
  business plans are per-user, reintroducing the exact per-seat cost previously rejected.
- **ISP static IP** — not repeatable, not universal, not vendor-controlled.

## Scale

Target load: one customer with ~20 field techs + ~5 office staff (~25 users). This is far
below any tunnel limit; a single `cloudflared` instance handles thousands of concurrent
connections.

**The real ceiling is elsewhere and is explicitly out of scope here:** the dashboard has no
per-entity caching or optimistic UI — every mutation triggers a full `/api/dashboard`
refetch (`useDashboardData.reload()`). At ~25 concurrent users on one office desktop
running Next.js + Postgres, that pattern is the first thing to strain. Tracked separately.

## Architecture

```
Field tech phone ──HTTPS──> Cloudflare edge ──outbound tunnel──> cloudflared
                                                                  (Windows service,
                                                                   office PC)
                                                                     │ loopback http
                                                                     ▼
                                                            Next.js server :3000
                                                            + bundled PostgreSQL
```

- Hostname: `https://<customer>.field.<vendordomain>/field` — **no `:3000` in the URL.**
- TLS terminates at Cloudflare's edge; the origin hop is loopback on the office PC, so the
  unencrypted segment never leaves the machine.
- Data continues to live entirely on-prem. Only transit is proxied.
- Electron desktop app is unchanged: it loads `http://localhost:3000` directly.

**Disclosure required:** traffic transits Cloudflare, which terminates TLS. This
contradicts current doc language ("no cloud relay or third-party tunneling service in the
middle") and that language must be rewritten, not quietly dropped.

## App-side changes

These are independent of Cloudflare, fix real defects, and must land **before** the tunnel —
the tunnel is precisely what introduces HTTPS and proxied client IPs.

### 1. Session cookie: derive `secure` per request

`getSessionCookieOptions()` currently sets `secure` from a deployment-wide flag:

```ts
secure: process.env.NODE_ENV === "production" && process.env.REQUIRE_HTTPS === "true"
```

`secure` is a **per-request** property, but this is a **global boolean**. One server now
serves two protocols at once (Electron over `http://localhost`, techs over `https://`), so
a single flag is guaranteed wrong for one of them. Setting it wrong causes the documented
silent failure: login appears to submit, the browser refuses the `Secure` cookie, and the
user is bounced to `/login` with no error.

**Change:** derive `secure` from the request protocol (`x-forwarded-proto === "https"`,
which Cloudflare sets). HTTPS request → `Secure`; localhost HTTP → not. Correct in every
topology.

**Consequence: `REQUIRE_HTTPS` is deleted entirely**, along with its env-var docs. The
failure mode ceases to exist rather than being documented around.

Spoofing `x-forwarded-proto: https` only makes the cookie *more* restrictive — fails safe.

`getSessionCookieOptions()` gains a request/protocol parameter. Three call sites:
`login`, `change-password`, `logout`.

### 2. Fix `clearSessionCookie` (latent bug)

```ts
res.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
```

Drops `secure`/`httpOnly`/`sameSite`. Once cookies are `Secure`, a mismatched clear can
fail to delete in some browsers, leaving users unable to log out cleanly. Must reuse the
same options object used to set it.

### 3. Rate limiting: layered, IP-tolerant

Current: a single per-IP bucket, 20 attempts / 5 min, keyed by

```ts
req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
```

Three defects at 25 users:

- **`|| "unknown"` collapses every user into one shared bucket.** If the header is missing
  or misread, the entire company shares 20 attempts per 5 minutes. Silent and catastrophic.
- **Shared IPs break per-IP limiting.** The 5 office staff sit behind one NAT. Mobile
  carriers also use CGNAT, so 20 techs appear as a handful of IPs. A few mistyped
  passwords could lock out a whole crew.
- **`CF-Connecting-IP` is the authoritative client IP** behind the tunnel;
  `x-forwarded-for` is a weaker fallback.

**New design — three layers, keeping what already works:**

| Layer | Key | Purpose |
|---|---|---|
| 1. Account lockout *(exists, keep)* | `User.failedLoginAttempts` / `lockedUntil` | 5 fails → 15 min. DB-persisted, survives restart, IP-independent. **The real control against credential stuffing.** |
| 2. Per `(ip, username)` | `login:<ip>:<username>` | Users sharing a NAT no longer fight over one bucket. |
| 3. Per-IP ceiling | `login:<ip>` | Generous (~100/5 min) — never trips a legitimate office or carrier NAT, still caps username spraying from one source. |

Client IP resolution: prefer `CF-Connecting-IP`, then first `x-forwarded-for` entry, then
socket address. **If unresolvable, skip the IP layers entirely — never fall back to a
shared constant.** Layer 1 still protects the account.

The in-memory limiter is adequate at this scale (single process; the security-critical
state is DB-persisted in layer 1).

## Provisioning

Per-customer setup must be **scripted**, or it is not repeatable:

1. Create named tunnel (`cloudflared` CLI).
2. Create DNS record for `<customer>.field.<vendordomain>` (Cloudflare API).
3. Write credentials + config to the office PC.
4. Install and start `cloudflared` as an auto-restarting Windows service.
5. Verify end-to-end **from cellular with WiFi off** — testing on office WiFi proves nothing.

Also needed: a one-command diagnostic for support ("is the tunnel up?"), since a dead
tunnel means dead field access and an unpaid support call.

## Phases

- **Phase 0 — App hardening.** Cookie per-request `secure` (+ delete `REQUIRE_HTTPS`),
  `clearSessionCookie` fix, layered rate limiting, client-IP resolution. Unit tests for all
  of it (no DB needed; follows existing `auth.test.ts` patterns). Zero infra dependency.
- **Phase 1 — Tunnel proof of concept.** Buy domain, add to Cloudflare, create one tunnel
  by hand, verify end-to-end from cellular. Confirms the approach before automating.
- **Phase 2 — Provisioning automation.** Script the per-customer steps; resilient service
  install; health-check/diagnostic command.
- **Phase 3 — App integration.** Field Access QR / field-URL handling for tunnel hostnames
  (no `:3000`); optional tunnel-status indicator in Settings.
- **Phase 4 — Documentation.** Rewrite `MANUAL_Setup_Installation.md` §7,
  `MANUAL_White_Glove_Installation.md` Phase B (its CGNAT dead-end disappears),
  `MANUAL_Troubleshooting.md` (new tunnel symptoms), `CLAUDE.md` (field-access architecture
  and the removal of `REQUIRE_HTTPS`), `launch-checklist.md`. Regenerate the stale
  `MANUAL_White_Glove_Installation.html` (last built 2026-07-04, ~2 weeks behind its `.md`).

**No migration phase.** There are no production customers yet, so port forwarding + DDNS is
removed outright rather than grandfathered.

## Verification criteria

Phase 1 is not complete until all of these are observed, not assumed:

- [ ] `https://<customer>.field.<vendordomain>/field` loads from a phone **on cellular, WiFi off**.
- [ ] Field tech login succeeds and the session persists across navigation (`Secure` cookie accepted).
- [ ] **Electron desktop login still works** on `http://localhost:3000` — the specific regression this design is built to prevent.
- [ ] Logout clears the session cleanly in a browser (validates the `clearSessionCookie` fix).
- [ ] Rate limiting observes distinct client IPs — two devices on different networks land in different buckets, and a shared NAT does not cross-lock users.
- [ ] Tunnel auto-recovers after the office PC reboots and after killing the service.
- [ ] No inbound port forward exists on the customer router.

## Out of scope

- Cloudflare Access in front of the app (the app has its own auth; consumes Zero Trust
  seats and adds tech friction).
- In-app tunnel management UI (vendor-side script is sufficient).
- Dashboard caching / optimistic UI (the real scale ceiling — separate work).
- Paid Cloudflare tiers.

## Risks

| Risk | Mitigation |
|---|---|
| Single vendor Cloudflare account = shared blast radius; a misconfiguration affects every customer at once | Accepted for now. Revisit per-customer accounts if the customer base grows enough that simultaneous outage is intolerable. |
| Product depends on a third party's free tier | Tunnels have been free for years. Migration path exists (vendor VPS + frp/Caddy) if terms change; the app-side changes in Phase 0 are independent of Cloudflare and remain valid. |
| `cloudflared` dies on a customer PC → field access down, unpaid support call | Auto-restarting service + one-command diagnostic + documented troubleshooting entry. |
| Traffic transits a third party that terminates TLS | Disclose explicitly in customer-facing docs; data at rest stays on-prem. |
