# Handoff — 2026-07-21

Supersedes `HANDOFF_2026-07-20-phase1.md` (deleted — its "next action", Step 4, is done).

---

## ✅ RESOLVED 2026-07-22 — read this first

**Root cause of the silent phone-login failure: Next 16's dev server blocks cross-origin
requests to `/_next/*` (JS chunks + HMR) by default.** The tunnel was pointed at `npm run
dev`, so the phone (origin `demo.whitevanops.com`, not `localhost`) received the SSR HTML but
had its JavaScript **blocked** → React never hydrated → the Sign In button never wired up its
handler → a tap did nothing: no POST, no error, just a static page. The prior "silent reset to
a blank form" was the un-hydrated page, not a failed redirect.

This single cause explains every dead end in §2/§3 below:
- curl worked because curl needs no JS.
- Zero `POST /api/auth/login` ever reached the origin because the client fetch never ran.
- Cloudflare showed no block because the block was at the **Next dev server**, not the edge.
- Electron/localhost worked because it is same-origin — no cross-origin restriction.

**The "cookie not retained/resent" theory in §2 is disproven.** Once JS ran, a live beacon
fired *after* the login POST with the session cookie already present, and the phone navigated
`change-password → dashboard` fully authenticated. The cookie/`Secure`/middleware chain was
always correct.

**Fix:** `next.config.ts` now sets `allowedDevOrigins: ["demo.whitevanops.com"]` (dev-only;
production `next start` / Electron standalone / PM2 impose no such restriction, so the shipped
product was never affected). Verified end-to-end from an iPhone over cellular on 2026-07-22.

**Diagnosis method (for next time a phone "does nothing"):** temporary middleware request log
(method + full URL + headers) plus client-side GET beacons at mount / tap / fetch-outcome
showed exactly how far the client JS got — the mount beacon never firing was the tell that
hydration, not the network or the server, was dead. All that instrumentation has been removed;
only the `allowedDevOrigins` line remains.

Everything below is the original 2026-07-21 handoff, preserved for history.

---

## TL;DR

**Phase 1 Step 4 is done and verified end-to-end from the desktop.** Tunnel `wvo-demo` is
created, DNS routed to `demo.whitevanops.com`, `config.yml` written, tunnel + app run and were
confirmed working (valid TLS, login page renders, curl round-trip of a full login proves the
server/cookie/middleware chain is 100% correct). **But the phone cannot actually log in over
the tunnel** — login appears to submit, then silently resets to a blank login form with no
error. This is now a real, unexplained bug blocking the rest of Step 6. Root cause **not yet
found** despite extensive elimination (see below). **Start here tomorrow: get real
browser-devtools visibility into the phone's actual network request** — that is the one piece
of evidence nothing else has substituted for.

Two unrelated app-side tasks (client-owned-connectivity plan, Tasks 1–2) were completed and
merged to `main` earlier this session — not related to this blocker. See
`docs/superpowers/plans/2026-07-21-client-owned-standalone-connectivity.md`.

## 1. What's confirmed working

- Tunnel created: `wvo-demo`, id `3eedf1be-d538-4693-8022-58f281eb18b5`. DNS routed to
  `demo.whitevanops.com`. Config at `%USERPROFILE%\.cloudflared\config.yml` (ingress →
  `http://localhost:3000`).
- `https://demo.whitevanops.com/field` loads correctly on cellular (WiFi off) in the browser —
  valid TLS, redirects to `/login`, renders correctly. Confirmed in Safari, Chrome, and Chrome
  Incognito on the phone.
- **Electron/localhost login works fine** — logged in successfully, forced password change
  completed.
- Cloudflare correctly forwards `x-forwarded-proto: https` (verified via a temporary debug log,
  since removed) — `isSecureRequest()`/cookie `Secure` derivation is working as designed.
- **Full login round-trip proven correct via curl through the tunnel**: `POST
  /api/auth/login` with valid credentials returns a well-formed `Set-Cookie` (`Secure;
  HttpOnly; SameSite=lax; Path=/`); replaying that cookie against `GET /change-password`
  returns `200`, and against `GET /` correctly `307`s to `/change-password` (middleware honors
  `mustChangePassword`). **The server, cookie logic, and tunnel header-forwarding are not the
  bug.**
- Cloudflare Firewall Events (24h export) show **no block on `/api/auth/login`** — every
  blocked event is unrelated bot/scanner noise (WordPress CVE probes, GPTBot, Googlebot, a
  `/auth`-path hit from an unrelated Swedish proxy ASN, not the user's phone). **Bot Fight Mode
  is confirmed off** (still listed as a dashboard *suggestion*, not enabled).

## 2. The actual bug

Phone (any browser) submits real, correct login credentials on `https://demo.whitevanops.com`
→ **no error text appears at all** → form resets to a fresh, empty login page. This only
happens on the phone over the tunnel; never on localhost.

No app code path produces this: a wrong password always sets a visible red error and leaves
the typed fields in place (`src/app/login/page.tsx`). A blank silent reset only happens if
login actually **succeeds**, `router.push()` fires, and the *next* request gets bounced by
`src/middleware.ts` for lacking a valid session — i.e., **the Set-Cookie the phone receives is
not being retained/resent**, even though curl proves the exact same cookie round-trips
perfectly.

### Ruled out (with evidence, not assumption)

| Hypothesis | How it was ruled out |
|---|---|
| Wrong password / stale credentials | User confirmed using the exact password just set on localhost; also reproduced identically with a fresh `admin`/`admin` reset |
| DB account lockout | Checked `User` row directly — never locked (`lockedUntil` null) |
| Cookie `Secure`/middleware logic bug | Full curl round-trip (login → Set-Cookie → replay → `200`/correct `307`) proves this exactly correct |
| `x-forwarded-proto` not forwarded | Confirmed via temporary debug log: cloudflared forwards `https` correctly |
| Cloudflare WAF / Bot Fight Mode blocking the POST | Bot Fight Mode off; Firewall Events export shows zero blocks on `/api/auth/login` in the last 24h |
| Service worker interference | `public/sw.js` explicitly skips non-GET and `/api/*`; also isn't even registered yet at the point `/login` is reached (registration only happens inside `/field`'s mounted `useEffect`, which a server-side redirect never reaches) |
| Browser-specific bug/extension | Identical failure in Safari, Chrome, and Chrome **Incognito** — rules out extensions and most per-browser settings |
| Private browsing blocking cookies | User confirmed not in private mode |
| Device clock skew (cookie `Expires` misjudged) | User confirmed clock is automatic/network-synced |
| Parental controls / MDM profile intercepting POST | User confirmed none on this device — this was the leading hypothesis and it's now weakened; **do not assume it's still MDM/carrier filtering without new evidence** |

### Direct evidence the request never reaches the origin at all

Added a temporary `console.log` at the top of `POST /api/auth/login` (reverted after each use —
working tree is clean, `git status` confirms no leftover diff). Result: **the dev server's
request log shows zero `POST /api/auth/login` entries from any of the phone's several login
attempts** — every visible request around that time is `GET /login`, `GET /login?`, `GET
/manifest.webmanifest` cycling, over and over, with no POST in between. The only successful
`POST /api/auth/login 200` in the whole session's log is a **curl** test run from this machine,
not the phone.

**This means the phone's login POST is disappearing before it reaches this server, and (per
§1) also before triggering any Cloudflare firewall block.** That's a strange combination and is
exactly why this isn't solved yet — the two most obvious places to look for the answer
(app/cookie logic, Cloudflare's WAF) have both been directly checked and cleared.

## 3. What to try next (in priority order)

1. **Get real DevTools visibility into the phone's actual request** — this is the single
   missing piece of evidence. Ask whether the phone is Android or iPhone:
   - **Android:** plug into this Windows PC via USB, enable USB debugging, open
     `chrome://inspect/#devices` in desktop Chrome, inspect the phone's tab live, watch the
     Network tab for the login `POST` (does it fire at all? what status/response, if any? any
     console errors?).
   - **iPhone:** Safari's remote Web Inspector requires a **Mac** — not available on this
     Windows machine. If no Mac is reachable, fall back to: re-add the temporary
     `console.log` in the login route, and additionally add a **client-side** `console.log`
     right before/after the `fetch()` call in `src/app/login/page.tsx`, then have the user
     read back what appears in Safari's own on-device error console if reachable (Settings →
     Safari → Advanced → Web Inspector, still needs a Mac to view) — otherwise this path may
     be a dead end without borrowed Mac hardware.
2. **Try a different network path** (a friend's hotspot, different carrier, or public WiFi
   with cellular data off) to isolate carrier vs. device. Not done yet — no alternate
   network/device was available this session.
3. **Try a different phone entirely**, if one becomes available, to isolate device vs.
   account/carrier.
4. Only after (1) shows something concrete: re-add the temporary origin-side debug log
   *simultaneously* with a live DevTools session, so both ends of the same request are visible
   in the same moment — the previous attempts checked each end at a different time, which is
   enough to rule things out but not enough to catch a live race/timing issue if one exists.

## 4. Repo / environment state

- Branch `main`, working tree **clean** (`git status --short` empty). All temporary debug
  `console.log` additions were added and reverted in `src/app/api/auth/login/route.ts` —
  nothing shipped.
- **Everything stopped cleanly**: `cloudflared tunnel run wvo-demo`, `npm run dev`, and the
  bundled Postgres (`pg_ctl stop`) were all shut down at the end of this session. Ports 3000
  and 5433 are free.
- Tunnel, DNS route, and `config.yml` are **left in place** — no need to redo Step 4. To
  resume: start Postgres (`./pgsql/bin/pg_ctl.exe -D "$APPDATA/whitevanops/pgdata" -w start`),
  `npm run dev`, then `cloudflared tunnel run wvo-demo` (or install as a service per the
  original runbook's Step 7, once login actually works).
- **`admin` account is currently in a reset state**: password is `admin`/`admin`,
  `mustChangePassword: true`. Whoever logs in next (locally or via phone) will be forced
  through the change-password flow again.
- Merged and cleaned up this session (unrelated to the login bug): the
  `client-owned-standalone-connectivity` app-side slice (Tasks 1–2 of
  `docs/superpowers/plans/2026-07-21-client-owned-standalone-connectivity.md`) — merged to
  `main` at `37b9d42`, worktree removed, branch deleted. Spec/plan docs committed at `8ad9716`
  / `13ae130`.

## 5. Original runbook status (for reference)

`docs/superpowers/plans/2026-07-20-phase-1-tunnel-runbook.md` Steps 1–5 are done. Step 6
(cellular verification checklist) is **blocked** on the login bug above — everything else in
that checklist (page loads, Electron regression check, no port forward) has passed; only "field
tech login succeeds; session persists" and "logout clears the session" remain unverified
because login itself doesn't complete on the phone. Step 7 (install as Windows service) is not
started — deliberately held until login actually works, per the runbook's own reasoning
("whatever proves true here becomes the Phase 2 script").
