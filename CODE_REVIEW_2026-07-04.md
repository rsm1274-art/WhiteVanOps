# WhiteVanOps — Folder Review & Remediation Plan

**Date:** 2026-07-04
**Scope:** Full-folder review (no changes made). Findings are ranked by severity with the
risk of leaving each untouched weighed against the cost/benefit of fixing it.

> Reviewer's note: this is an evaluation only. Nothing in the repo was modified. Every code
> reference below was read directly from the current source before being written up.

---

## Remediation status (updated 2026-07-04)

The three 🔴/🟠 items have been addressed in code:

- **#1 Firebase key** — added `firebase-service-account.json` and `*service-account*.json` (plus
  `license.json`, `*.key.json`) to [`.gitignore`](.gitignore); reworked
  [`scripts/license-manager.js`](scripts/license-manager.js) to load the key from
  `WVO_FIREBASE_SERVICE_ACCOUNT` / `GOOGLE_APPLICATION_CREDENTIALS` (a path *outside* the repo),
  with the in-repo path kept only as a gitignored fallback. Documented in
  [`.env.example`](.env.example) and Setup manual §10.
  **⚠️ Two manual steps remain that only you can do:** (a) **rotate** the key in the Firebase
  console — assume the committed copy is compromised — and (b) **move** the key file out of the
  project folder to e.g. `%APPDATA%\whitevanops-secrets\`. The existing file was left in place
  (now gitignored) rather than deleted, so you don't lose your only copy before rotating.
- **#2 Secret/git hygiene** — same `.gitignore` hardening covers the `.env*` + key exposure.
  Initializing the app as a **private** repo and adding a secret-scan pre-commit hook is a
  process step for you to take before the first commit (see item #2 below).
- **#3 Licensing DRM + activation window** — the local license file is now HMAC-signed and
  verified in [`electron/main.js`](electron/main.js) (`signLicense` / `verifyLicenseSilent`), so
  a hand-edited `license.json` is rejected; the activation window was moved to
  `nodeIntegration:false / contextIsolation:true` with a new
  [`electron/activation-preload.js`](electron/activation-preload.js) bridge, and the one-shot
  IPC listener bug (a mistyped key couldn't be retried) was fixed. Existing installs re-activate
  once — documented in Setup manual §12.

The 🟡/🟢 items below remain open as originally written.

---

## Severity legend

| Level | Meaning |
|---|---|
| 🔴 **Critical** | Credential exposure or a foot-gun that can leak secrets / compromise the product. Fix now. |
| 🟠 **High** | Real security or data-integrity weakness; exploitable or damaging under plausible conditions. |
| 🟡 **Moderate** | Functional bug or defense-in-depth gap. Won't sink you today; will bite eventually. |
| 🟢 **Minor** | Hygiene, maintainability, or low-likelihood issues. Cheap to fix, easy to defer. |

---

## 🔴 1. A live Firebase private key sits unignored in the project root

**What I found**

- [`firebase-service-account.json`](firebase-service-account.json) is present in the root and
  contains a real `private_key` / `private_key_id` / `client_email` (a Google service-account
  credential for the `white-van-ops-licensing` Firebase project).
- It is **not** listed in [`.gitignore`](.gitignore) (which only covers `.env*`, `*.pem`, build
  output, etc.).
- It is only consumed by [`scripts/license-manager.js`](scripts/license-manager.js) — a
  build-time admin tool you run to mint license keys. It is **not** needed by the shipping app
  and is **not** bundled into the installer (it's absent from the `extraResources` list in
  [`package.json`](package.json)). So it has no business being in a distributable tree.

**Risk of leaving it**

This key has full admin authority over your licensing Firestore. Anyone who obtains it can mint
unlimited license keys, deactivate customers, or read/alter license records — i.e. defeat your
entire monetization model. The exposure path is very live: your GitHub account already hosts a
**public** repo of the same product name (see #2). One `git init && git add . && git push` from
this folder publishes the key to the internet, where it is scraped within minutes.

**Fix (cheap, high benefit)**

1. Add `firebase-service-account.json` (and a `*service-account*.json` glob) to `.gitignore`
   now, before this folder ever becomes a git repo.
2. Treat the current key as compromised on principle: **rotate it** in the Firebase console
   (Project Settings → Service accounts → generate new key, delete old).
3. Store the working copy outside the repo (e.g. `%APPDATA%\whitevanops-secrets\`) and point
   `scripts/license-manager.js` at it via an env var (`GOOGLE_APPLICATION_CREDENTIALS` or a
   custom path), rather than `path.join(__dirname, "..")`.

**Benefit of fixing:** removes the single highest-impact leak vector in the tree.
**Cost:** ~15 minutes. No downside.

---

## 🟠 2. Secrets present in a non-git folder that shares a name with a public repo

**What I found**

- The root project is **not a git repository** (`git rev-parse` fails), yet it holds
  [`.env`](.env), [`.env.local`](.env.local) (both with `DATABASE_URL` + `SESSION_SECRET`) and
  the service-account key above.
- The [`marketing/`](marketing) subfolder **is** a git checkout whose `origin` is
  `https://github.com/rsm1274-art/WhiteVanOps.git` — a **public** GitHub Pages repo.

The danger is the mismatch: your public repo is literally named `WhiteVanOps`, the same as the
product. It is easy, when you eventually decide to version-control the app, to point it at that
existing public remote or to run git from the wrong directory and push the whole tree —
including `.env`, `.env.local`, and the Firebase key — to the public.

**Risk of leaving it**

`SESSION_SECRET` leaking lets an attacker forge session JWTs for **any** role (superuser
included), because the token is verified only against that secret
([`src/lib/auth.ts:21`](src/lib/auth.ts), [`src/middleware.ts:33`](src/middleware.ts)). Combined
with #1 and the DB URL, a single mispushed commit is a full compromise.

**Fix**

1. Decide the app's version-control story deliberately: initialize a **private** repo for the
   app with `.gitignore` in place *first*, verify `git status` shows no `.env*` or
   `*service-account*.json`, then make the first commit.
2. Never share a remote between the public marketing site and the private app. Consider renaming
   the public repo (e.g. `whitevanops-site`) to eliminate the name collision.
3. Add a pre-commit guard (e.g. `gitleaks`) so a secret can't be committed even by accident.

**Benefit:** eliminates the accidental-push class of incident.
**Cost:** ~30 minutes of setup.

---

## 🟠 3. Licensing DRM is trivially bypassable, and its activation window is insecure

**What I found** — [`electron/main.js`](electron/main.js)

- `verifyLicenseSilent()` (~line 165) reads `%APPDATA%\whitevanops\license.json` and considers
  the app licensed if `data.machineId === machineIdSync()`. There's no signature and no server
  re-check on subsequent launches — anyone can hand-craft that JSON with their own machine id
  and skip activation permanently.
- The activation window is created with `webPreferences: { nodeIntegration: true,
  contextIsolation: false }` (~line 186), while every other window correctly uses
  `nodeIntegration: false, contextIsolation: true`. It loads a local file, so exposure is
  limited, but it's the one window with the weak posture and it's the one handling license input.

**Risk of leaving it**

This is a **business** risk more than a user-safety one: the license gate is cosmetic and a
mildly technical user bypasses it in a text editor. If piracy resistance matters to the revenue
model, this doesn't provide it. The insecure Electron flags are a latent security smell that
would become dangerous the moment that window ever loads remote content.

**Fix**

- Sign the local license blob with a key baked into the app (or a server-issued signed token)
  and re-validate the signature in `verifyLicenseSilent()` so a hand-edited file fails.
- Optionally add a periodic (e.g. weekly) online re-check with graceful offline tolerance.
- Bring the activation window to `nodeIntegration: false, contextIsolation: true` and use a
  `preload` + `contextBridge` for the `verify-license` IPC, matching the other windows.

**Benefit:** turns the license gate from decorative into meaningfully enforced; closes the lone
insecure Electron window.
**Cost:** Half a day. Only worth it if licensing revenue is a real concern — otherwise
consciously accept the risk and just fix the Electron flags (an hour).

---

## 🟡 4. Command-injection surface in the database-backup route

**What I found** — [`src/app/api/settings/backup/route.ts`](src/app/api/settings/backup/route.ts)

```js
const cmd = `"${pgDumpExe}" --dbname="${dbUrl}" --file="${filePath}" --format=c --compress=9`;
await execAsync(cmd);
```

`filePath` is built from `targetDir`, which is an admin-editable value read from the
`backup_target_dir` system setting. It (and `dbUrl`) are interpolated straight into a shell
string passed to `exec`. A crafted directory value containing quotes/`&`/`;` could inject
additional commands run with the server's privileges.

**Risk of leaving it**

The privilege boundary softens this: only `admin`/`superuser` can set the backup directory, and
they're already trusted. So this is not a privilege-escalation hole *today*. But it's fragile —
a path with a space or an ampersand silently corrupts the backup command, and it's exactly the
kind of pattern that becomes a real vulnerability the moment the setting becomes settable by a
lower role or via import. Error text (`error.message`) is also returned to the client, leaking
internals.

**Fix**

- Use `execFile('pg_dump', [ '--dbname', dbUrl, '--file', filePath, '--format=c',
  '--compress=9' ])` — argument array, no shell, no interpolation.
- Validate `targetDir` is an existing absolute directory (already partly checked) and reject
  paths containing shell metacharacters.
- Return a generic error to the client; log the detail server-side only.

**Benefit:** removes an injection vector and makes backups robust to odd paths.
**Cost:** ~30 minutes.

---

## 🟡 5. Session-cookie `Secure` flag is inconsistent between login and change-password

**What I found**

| Route | `secure:` |
|---|---|
| [`login/route.ts:49`](src/app/api/auth/login/route.ts) | `NODE_ENV === "production" && REQUIRE_HTTPS === "true"` |
| [`change-password/route.ts:61`](src/app/api/auth/change-password/route.ts) | `NODE_ENV === "production"` |

Two problems:

1. **Functional bug for first-login-over-HTTP.** In a production build served over plain HTTP
   (the LAN scenario the `REQUIRE_HTTPS` opt-out exists for), login stores the cookie
   (`secure:false`) but change-password sets `secure:true`, so the browser silently drops the
   re-issued cookie. A user forced to change their password on first login gets bounced straight
   back to `/login` with no error — the exact silent-bounce failure mode CLAUDE.md documents for
   the old cookie behavior, reintroduced on this one path.
2. **Security posture.** `REQUIRE_HTTPS=false` (the default, since the flag is undocumented and
   set nowhere — it's absent from [`.env.example`](.env.example)) means production session
   cookies are transmitted over plaintext HTTP and are sniffable on the LAN → session
   hijacking. The intended fix per CLAUDE.md is `tailscale serve` (HTTPS); the `REQUIRE_HTTPS`
   escape hatch quietly undercuts that.

**Risk of leaving it**

Field techs forced to change a password over LAN HTTP can't complete login. And any HTTP
deployment ships hijackable sessions. Both are real, both are silent.

**Fix**

- Make the two routes agree — use one shared cookie-options helper so `secure` can never drift.
- Document `REQUIRE_HTTPS` in `.env.example` with a loud warning that `false` means plaintext
  sessions, and default the deployment path to HTTPS (tailscale) so the flag stays `true`.

**Benefit:** fixes a silent login failure and closes a session-sniffing hole.
**Cost:** ~20 minutes.

---

## 🟡 6. No brute-force protection on login

**What I found**

There is no rate limiting, throttling, or account lockout anywhere in
[`src/app/api/auth`](src/app/api/auth) or [`src/middleware.ts`](src/middleware.ts).
`POST /api/auth/login` will accept unlimited password guesses.

**Risk of leaving it**

For a small internal LAN tool this is a lower priority, but once the app is reachable over
Tailscale/HTTPS by field techs, an unlimited-guess login endpoint plus human-chosen passwords
(min length 8, no complexity — see #8) is a realistic path to account takeover.

**Fix**

- Add per-username + per-IP rate limiting (e.g. a small in-memory or DB-backed counter;
  exponential backoff after N failures), and consider a temporary lockout.
- Log repeated failures to the existing `AuditLog`.

**Benefit:** makes password guessing impractical.
**Cost:** ~1–2 hours for a simple implementation.

---

## 🟢 7. Tech authorization gap when a tech has no linked personnel record

**What I found** — [`src/app/api/jobs/route.ts:87`](src/app/api/jobs/route.ts)

```js
if (user.personnelId) {
  const assignment = await prisma.jobAssignment.findFirst({ where: { jobId, personnelId: user.personnelId } });
  if (!assignment) return ... 403;
}
```

The "are you assigned to this job?" check is **skipped entirely** when `user.personnelId` is
falsy. A tech account created without a linked `Personnel` record could therefore change the
status of **any** job, not just assigned ones. (The time route at
[`time/route.ts`](src/app/api/time/route.ts) handles the same case correctly — it *rejects* when
`personnelId` is missing.)

**Risk of leaving it**

Low likelihood (tech accounts are normally linked), bounded impact (status changes only, not
data edits — those are already blocked). But it's an inconsistent authz rule and a latent
privilege gap.

**Fix**

Mirror the time route: if `user.role === "tech"` and there's no `personnelId`, reject with 403
rather than falling through. **Cost:** 5 minutes.

---

## 🟢 8. Weak/inconsistent password policy

**What I found**

- Self-service change ([`change-password/route.ts`](src/app/api/auth/change-password/route.ts))
  enforces only: length ≥ 8 and not literally "admin".
- Admin-created / admin-updated users ([`users/route.ts`](src/app/api/users/route.ts)) enforce
  **no** length or complexity at all — a superuser can set a 1-character password.

**Risk of leaving it** — Weak passwords across the fleet, amplified by the lack of brute-force
protection (#6).

**Fix** — Centralize one `validatePassword()` helper (min length, basic complexity, block
common values) and call it from both routes. **Cost:** ~30 minutes.

---

## 🟢 9. No automated tests

**What I found** — No `*.test.*` / `*.spec.*` files anywhere; no test runner in
[`package.json`](package.json) scripts.

**Risk of leaving it** — The app has genuinely tricky invariants (double-booking conflict
checks, stock decrement on completion, role gating, date-as-local-noon handling). All of it is
verified only by hand. Regressions in these will be silent and land in a billing/inventory
context where they cost real money.

**Fix** — Add a lightweight test setup (Vitest) and cover the highest-value pure logic first:
[`jobConflicts.ts`](src/lib/jobConflicts.ts), [`recurrence.ts`](src/lib/recurrence.ts),
[`dateUtils.ts`](src/lib/dateUtils.ts), and the role checks in [`auth.ts`](src/lib/auth.ts).
**Cost:** ~half a day for a meaningful first pass. High long-term benefit.

---

## 🟢 10. Repo hygiene / clutter

- **Stale scratch files in `marketing/`:** [`marketing/test.js`](marketing/test.js) is a
  UTF-16-mangled dump and `extracted.js` is a working copy — both untracked (so *not* published),
  but they're litter in a folder that is a live public checkout. Delete them.
- **Stale Docker deploy scaffold:** `docker-compose.yml`, `Dockerfile`, `deploy/` are already
  documented as dead in CLAUDE.md. Consider removing them outright to stop them misleading
  future readers, or move them under a clearly-labeled `attic/`.
- **Committed build artifact:** `tsconfig.tsbuildinfo` (127 KB) is in the tree; it's ignored by
  `.gitignore` so it won't be committed, but it doesn't belong in a distributable folder.

**Risk:** cosmetic/maintainability only. **Cost:** minutes.

---

## Recommended order of operations

| # | Item | Severity | Effort | Do when |
|---|---|---|---|---|
| 1 | Ignore + rotate Firebase key | 🔴 | 15 min | **Immediately** |
| 2 | Private-repo/gitignore/secret-scan setup | 🟠 | 30 min | **Before first commit** |
| 5 | Fix cookie `Secure` divergence + document `REQUIRE_HTTPS` | 🟡 | 20 min | This week (login is broken over HTTP) |
| 4 | `execFile` in backup route | 🟡 | 30 min | This week |
| 7 | Tech-without-personnelId authz | 🟢 | 5 min | This week (bundle with #4/#5) |
| 6 | Login rate limiting | 🟡 | 1–2 h | Before external/Tailscale exposure |
| 8 | Unified password policy | 🟢 | 30 min | With #6 |
| 3 | Harden licensing + activation window | 🟠 | ½ day / 1 h | Only if licensing revenue matters; do the Electron-flags part regardless |
| 9 | Test scaffold + core-logic coverage | 🟢 | ½ day | Next quiet cycle |
| 10 | Clutter cleanup | 🟢 | 15 min | Anytime |

Items **1, 2, 5, 4, 7** are the high-benefit / low-cost cluster — a single focused session
closes the credential-leak exposure and the one route that's actually broken over HTTP.

---

## Things that are in good shape (for balance)

- Auth is properly centralized (`getSessionUser` / `requireRole`) and consistently called at the
  top of write routes; JWTs are `httpOnly` and role-checked in both middleware and routes
  (defense in depth).
- Passwords are bcrypt-hashed with cost 12; no plaintext storage.
- Prisma is used everywhere with parameterized queries — **no raw SQL / no SQL-injection
  surface** was found.
- The main and loading Electron windows use the correct `nodeIntegration:false /
  contextIsolation:true` posture (only the activation window regresses, per #3).
- Per-record tech authorization *is* enforced on the time route and mostly on the jobs route
  (only the missing-`personnelId` edge case in #7 leaks).
- `.env*` and the DB/pgsql folders are already gitignored — the one gap is the service-account
  key (#1).
