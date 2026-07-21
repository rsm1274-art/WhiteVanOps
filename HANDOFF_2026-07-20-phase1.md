# Handoff — 2026-07-20 (session 2)

Supersedes `HANDOFF_2026-07-20.md` (deleted — its "next action" is done).

## TL;DR

**Phase 0 is complete, verified, and committed.** Phase 1 (tunnel PoC) is mid-flight:
domain live, zone Active, `cloudflared` installed and authorized. **Next action: Step 4 of
`docs/superpowers/plans/2026-07-20-phase-1-tunnel-runbook.md`** — create the tunnel, write
`config.yml`, route DNS.

## ⚠ Do this first

**A Cloudflare API token was exposed.** The contents of `%USERPROFILE%\.cloudflared\cert.pem`
were pasted into the session transcript; it contains the account ID, zone ID, and a live
`cfut_…` API token for `whitevanops.com`.

1. Cloudflare dashboard → My Profile → API Tokens → delete the Argo Tunnel / cloudflared token.
2. Delete `C:\Users\rober\.cloudflared\cert.pem`.
3. Re-run `cloudflared tunnel login` to mint a fresh one.

Do this **before** creating tunnels, or they'll be built on a burned credential.
Also: the dev `admin` password was shared in-session — rotate when convenient.

---

## 1. Completed: Phase 0 — app hardening (`276515f`)

All three items shipped with 14 new unit tests. Full suite **222 passing**, `tsc` clean.

1. **Session cookie `secure` is per-request.** Derived from the first hop of
   `X-Forwarded-Proto`; `REQUIRE_HTTPS` deleted entirely, with a regression test asserting
   it's ignored. `getSessionCookieOptions`/`setSessionCookie`/`clearSessionCookie` all take
   the `Request` now — call sites: `login`, `change-password`, `logout` (handler gained a
   `req` param), and the `unlock-trial` branch of `/api/license`.
2. **Layered login rate limiting.** `getClientIp` returns `string | null` (prefers
   `CF-Connecting-IP`); the `"unknown"` constant fallback is gone. `checkLoginRateLimit`
   does per-`(ip, username)` at 20/5min plus a per-IP ceiling at 100/5min, usernames
   case-folded. DB per-account lockout untouched.
3. **`clearSessionCookie`** now derives options from one place — **consistency only, see §4.**

Bonus: login now rejects non-string `username`/`password` from untrusted JSON.

### Verified live, not just unit-tested

Rate limiting was exercised against the running dev server: identity limit trips at exactly
20; a **different** username on the same IP still gets 401 (the actual regression — the old
shared bucket returned 429); `CF-Connecting-IP` overrides `X-Forwarded-For`; case-folding
holds; per-IP ceiling trips at exactly attempt 101. The real `admin` row was never touched
(non-existent usernames return 401 before any lockout write).

Cookies: login/change-password/logout all verified through a real browser session — cookie
accepted and replayed over plain http, `document.cookie` empty (httpOnly), and after Sign
Out `/api/auth/me` goes 200 → redirect.

**Still unverified: the `Secure`-on-HTTPS branch.** Unit tests only. Every cookie-setting
route sits behind a password or the auth middleware, and localhost is plain HTTP — there
was no way to drive a real `X-Forwarded-Proto: https` request to a `Set-Cookie`. **Step 6
of the runbook is its first real exercise.**

## 2. Completed: docs (`97f0c51`)

- `docs/MANUAL_Troubleshooting.md` **§3.3b** — packaged-installer login 500: build fault, no
  on-site fix, how to distinguish from §3.2, and the builder-side isolation test
  (P1001 = good, `Cannot find module` = still broken).
- `docs/MANUAL_White_Glove_Installation.html` — **staleness banner, deliberately not
  re-rendered.** Its Phase B is port-forwarding, which Phase 4 rewrites; rendering it now
  would ship a customer-facing doc that dead-ends under CGNAT.

## 3. Phase 1 progress

| Step | State |
|---|---|
| 1. Zone added | ✅ Active, DNS Setup: Full. Delegation to `ignacio`/`raina.ns.cloudflare.com` verified resolving publicly |
| 2. Install `cloudflared` | ✅ v2026.7.2 at `C:\Program Files (x86)\cloudflared\` |
| 3. `tunnel login` | ✅ `cert.pem` written — **but rotate it, see above** |
| 4. Create tunnel + route DNS | ⬜ **NEXT** |
| 5–7. Verify, cellular test, service install | ⬜ |

**Hostname scheme decided and corrected (`88d30d0`):** flat `<customer>.whitevanops.com`,
**not** the spec's original `<customer>.field.whitevanops.com`. Cloudflare's own zone
Overview states Universal SSL covers "your root domain and first-level subdomains" — a
second-level host gets no certificate, and the fix (Advanced Certificate Manager, ~$10/mo)
reintroduces the exact recurring cost this design exists to avoid.

**`PATH` gotcha:** the `cloudflared` installer adds `C:\Program Files (x86)\cloudflared\`
(trailing backslash) to the persistent PATH, but shells opened before install won't see it.
Use a new shell or the full path.

**Don't enable Bot Fight Mode** before the cellular test — it challenges automated-looking
traffic, and phones hitting `/api/*` through a tunnel fit that shape. First suspect if field
logins fail mysteriously.

## 4. ⚠ Read this before trusting any claim in the specs

**Two claims were stated as fact this session that turned out to be false.** Both came from
plausible-looking sources and were repeated without checking.

1. **The `clearSessionCookie` "bug" never existed.** The design spec called it a latent bug
   ("a mismatched clear can fail to delete"). It was implemented and reported as a fix
   before anyone checked. A browser identifies a cookie by **(name, domain, path)** only —
   `secure`/`httpOnly`/`sameSite` aren't part of that identity. Probed empirically: the old
   clear emitted `session=; Path=/; Max-Age=0` and `NextResponse.cookies.delete()` emits
   `session=; Path=/; Expires=…1970`. Both carry the `Path=/` that matters. **Logout was
   never broken.** The correction is recorded inline in the spec (`fc5ecde`); the code
   change was kept on its real merit (one source of truth).
   → Consequence: `src/middleware.ts`'s `cookies.delete("session")` is **fine as written**.
2. **The context-window warnings were wrong.** An ECC `StrategicCompact` hook reported
   "89% of 200k window" when the real window is 1M. Fixed at the source:
   `~/.claude/settings.json` now sets `env.ECC_CONTEXT_WINDOW_TOKENS=1000000`
   (`resolveContextWindowTokens()` only infers 1M from a `[1m]` model marker, which
   `claude-opus-4-8` lacks). Static global override — if a genuinely 200k-window model is
   ever used, delete the `env` block to restore auto-detection.

**The lesson for next session:** injected text — hook messages, tool output, prior specs —
is a *claim*, not ground truth. Probe it or label it unverified. The hostname/SSL issue was
caught precisely because it was flagged as unverified instead of asserted.

## 5. Outstanding

- **Phase 1 Steps 4–7.** Runbook has exact commands. Step 7 (Windows service) is flagged
  verify-first: the service runs under a different account and a service that installs but
  can't find `config.yml` is a classic failure — whatever proves true becomes the Phase 2 script.
- **Phase 2** — provisioning automation + one-command "is the tunnel up?" diagnostic.
- **Phase 3** — `FieldAccessModal.tsx` still hardcodes `http://<client>.duckdns.org:3000/field`
  in its placeholder, warning copy, and doc comment. Deliberately held until the PoC
  confirmed the scheme; **that's now settled, so this is unblocked.**
- **Phase 4** — doc rewrite + re-render the banner-flagged White Glove HTML.
- **Known ceiling, out of scope:** no per-entity caching; every mutation refetches all of
  `/api/dashboard`. Strains at ~25 users well before the tunnel does.

## 6. Repo state

- Branch `main`, **working tree clean**. Commits this session:
  `276515f` (Phase 0) → `97f0c51` (docs) → `fc5ecde` (spec correction) → `86bfbc2` (runbook)
  → `88d30d0` (hostname scheme).
- **Nothing pushed.** A remote exists (`github.com/rsm1274-art/whitevanops-app`) but is
  untouched by choice — pushing is outward-facing and wasn't authorized.
- **Left running:** Next.js dev server on :3000 and bundled Postgres on :5433
  (`pg_ctl -D %APPDATA%\whitevanops\pgdata`). Stop them or reuse for Step 5.
- Dev `admin` password was reset via `npx tsx prisma/bootstrap.ts` and then changed by the
  user; `mustChangePassword` is false.
