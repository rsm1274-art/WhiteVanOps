# WhiteVanOps — Launch Checklist

**Product:** WhiteVanOps — an internal field-operations tool for one fleet-service business (jobs, crew, vehicles, inventory, QuickBooks export). Not a public product with sign-ups — it's used only by this company's own office staff and field technicians.

**Stack (plain English):** A web application (Next.js) backed by its own database (PostgreSQL), packaged two ways — as a Windows desktop program for the office, and as a plain web page field technicians open on their phones over your office WiFi/network.

**Estimated total time:** 3–4 hours spread over a few days (most of it is one-time setup; the actual "go live" moment is under an hour).

**Estimated monthly cost: $0.** Everything runs on hardware you already own. There are no third-party services, no payment processor, and no hosting bill — this is a self-hosted internal tool, not a cloud SaaS product.

**Legend**

- 🧑 **You** — needs your decision, your machine, or something only you can provide. An agent can't do this for you.
- 🤖 **Agent** — paste the given prompt into your coding agent (Claude, Cowork, etc.) and it does this in the codebase or via the command line.
- 🤝 **Together** — the agent prepares it, you click the final button or type in a value.

---

## Phase 0 — Fix what's currently broken (before anything else)

The codebase audit found two things worth fixing before you build the installer. Both are now done.

- [x] ✅ **Desktop installer icon replaced with your real logo.** Correction to the original audit: `src/app/favicon.ico` did already exist, so `npm run electron:build` wasn't actually going to fail — but the existing file was the generic default Next.js icon, unrelated to WhiteVanOps. It's been regenerated from `public/logo.png` (the van + "WVO" mark already used in the app's sidebar) into a proper multi-resolution `.ico` (16/32/48/64/128/256px), so the installer, desktop shortcut, and Start Menu entry now show your real branding instead of a placeholder. The original file was backed up first.

  **Known limitation:** your logo is a wide rectangular illustration (1024×545), not a pre-made square icon, so it was padded onto a square canvas rather than cropped — at very small sizes (16px, e.g. a browser tab or taskbar) it may look a little small/centered rather than filling the frame edge-to-edge. If that bothers you visually, have a designer produce a proper square icon mark later; this is good enough to ship.

- [x] ✅ **`.env.example` rewritten to match reality.** It previously listed `APP_USERNAME`/`APP_PASSWORD` as if they controlled login (leftover from an old, unused deployment path) — now it lists only the two variables the app actually reads, `DATABASE_URL` and `SESSION_SECRET`, with the correct port (5433) and a note on where each value is used, matching `MANUAL_Setup_Installation.md` section 9.

---

## Phase 1 — Accounts and prerequisites

No sign-ups needed — everything runs on machines you already control.

- [x] ✅ **Server machine decided: the current development machine.** PostgreSQL 9.5 already runs there on port 5433. Since this machine now doubles as the permanent server, it needs to be treated as production hardware going forward: stay powered on and network-connected during business hours, and — per Phase 3 below — Postgres needs to start automatically on boot instead of relying on `run_locally.bat` being run by hand each morning.

- [x] ✅ **Confirm Windows Firewall access.** Inbound rule "WhiteVanOps App (3000)" created (TCP 3000, Allow, Enabled, PrimaryStatus: OK).

---

## Phase 2 — Secrets and configuration

- [ ] 🤝 **Generate a real `SESSION_SECRET`.** (2 min) This is a random string used to cryptographically sign login sessions — think of it as the master key that proves a session cookie is genuine. The current `.env` has a placeholder (`dev-secret-change-in-production-32chars`) that must not be used for real logins.

  > Generate a new random 48-byte hex `SESSION_SECRET` (use `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and show it to me so I can put it in the real config file myself.

  **You'll know it worked when:** you have a long random string, and you paste it into `.env.local` yourself in the next step (never let it get committed to code or pasted into chat logs you don't control).

- [ ] 🧑 **Create the real `.env.local` on the server machine.** (10 min) This file is what the *running app* reads (as opposed to `.env`, which is only for command-line tools). Create it with:
  ```
  DATABASE_URL="postgresql://<db-user>:<db-password>@localhost:5433/white_van_ops?schema=public"
  SESSION_SECRET="<the random string from the previous step>"
  ```
  Use a real, non-default database password here — not the dev database you've been testing against, unless you're intentionally reusing it for the real launch.

  **You'll know it worked when:** `.env.local` exists on the server machine with real values, and it is *not* the same file you've been using for local development testing (or if it is, that's a deliberate choice, not an accident).

- [ ] 🧑 **Never share `.env` or `.env.local` outside the server machine.** (0 min, just a rule) Don't paste their contents into chat, email, or a ticket. If a value ever leaks, generate a new `SESSION_SECRET` and change the database password.

---

## Phase 3 — Production database

- [x] ✅ **PostgreSQL starts automatically.** Already registered as Windows service `postgresql-x64-9.5`, confirmed Running.

- [x] ✅ **Database schema applied to production.** `npx prisma migrate deploy` ran clean against the real `white_van_ops` database as `wvo_user`.

  **Note for future setups:** hit a real snag here worth remembering — `wvo_user` didn't exist yet (§2a setup SQL hadn't been run), and once created, needed explicit grants on *existing* tables/sequences (`GRANT ALL ... ON ALL TABLES IN SCHEMA public`, `ALTER DEFAULT PRIVILEGES ...`) since `GRANT ALL ON SCHEMA public` alone doesn't cover objects created earlier under the `postgres` role. Also `.env.local` had a literal unreplaced `<db-user>` placeholder in `DATABASE_URL` — always grep both `.env` and `.env.local` for `<` after editing to catch leftover placeholders.

- [x] ✅ **First real superuser created.** `npx tsx prisma/bootstrap.ts` succeeded: `admin`/`admin`, password change required on first login.

---

## Phase 4 — Deploy the app

This app has two faces — pick one path for each.

**Office desktop app:**

- [x] ✅ **Windows installer built.** `dist-electron/WhiteVanOps Setup 0.1.0.exe` exists.

  **Real bug caught and fixed here:** the first build was silently broken. `next.config.ts` didn't pin `outputFileTracingRoot`, so Next.js misinferred the workspace root because of an unrelated `package-lock.json` sitting in `C:\Users\rober\` (outside the project) — this nested the real `.next/standalone/server.js` three levels deeper than expected (`.next/standalone/Desktop/WhiteVanOps/server.js`). `electron-builder`'s `extraResources` config copies the flat `.next/standalone` into `resources/nextjs`, and `electron/main.js` requires `server.js` directly at that flat path — so the first installer would have failed to launch on every machine it was installed on. Fixed by adding `outputFileTracingRoot: path.join(__dirname)` to `next.config.ts`, then rebuilding clean. Confirmed `Test-Path .next\standalone\server.js` returns `True` post-fix. **The installer was rebuilt after this fix — the current `.exe` in `dist-electron/` is the good one.**

- [ ] 🧑 **Install it on each office machine.** (10 min per machine) Copy the `.exe` to each admin/superuser's machine and run it. You'll see an "Unknown Publisher" SmartScreen warning — that's expected for internal software without a paid code-signing certificate; click "More info → Run anyway."

  **You'll know it worked when:** the app opens to the login screen and a desktop shortcut exists.

**Field tech access (recommended path — dedicated server process):**

- [x] ✅ **Standalone server running via pm2.** `pm2 list` shows `whitevanops` as `online`, 0 restarts. Registered to survive reboot via `pm2-windows-startup` (Windows doesn't support `pm2 startup` directly — that's Linux-only).

  **Notes for future setups (Windows-specific gotchas hit along the way):**
  - `pm2 start "npm start" --name whitevanops` doesn't work on Windows — PM2 tries to run `npm.cmd` through the Node interpreter and fails with a syntax error. Also, `next start` doesn't work with `output: standalone` at all. Correct command: `pm2 start .next/standalone/server.js --name whitevanops` (after copying `.next/static`, `public/`, and `.env.local` into the standalone folder — `next build` doesn't do this automatically outside of `electron-build.js`).
  - Global npm installs (`pm2`, `pm2-windows-startup`) may not be on PATH in the current shell — prefix commands with `npx` if you get "not recognized" errors.
  - `next build` deletes and regenerates `.next/standalone`, which fails with `EBUSY` if pm2 already has `server.js` open. Always `pm2 stop whitevanops` before rebuilding, then redo the copy steps and `pm2 restart` after.

- [x] ✅ **Field tech access switched to Port Forwarding + Dynamic DNS — supersedes the raw-LAN-IP and Tailscale approaches.** Testing local LAN IPs often fails due to AP isolation, and Tailscale (while secure) introduces subscription fees beyond the free tier.
  **Current setup:** The office server is configured with a static local IP. The office internet router is configured to port forward external traffic on port `3000` to the server's local IP on port `3000`. A Dynamic DNS (DDNS) service like DuckDNS is set up to provide a static URL (e.g. `http://client.duckdns.org:3000/field`).
  **Crucial fix:** Next.js production builds normally require HTTPS for the session cookie. Since DDNS over raw port forwarding is plain HTTP, `src/app/api/auth/login/route.ts` was updated to no longer strictly require `secure: true` unless explicitly configured, so mobile tech logins won't silently fail.

---

## Phase 5 — Network access ("domain," adapted for a LAN tool)

This app doesn't need a public domain or HTTPS certificate — it's only reachable from your office network, not the open internet, so skip the usual "buy a domain, set up DNS" phase entirely.

- [ ] 🧑 **Optional: give the server machine a fixed local IP.** (10 min) By default, most home/office routers hand out IP addresses that can change. If the server's IP changes, every field tech's bookmark breaks. In your router settings, reserve a fixed ("static") IP for the server machine's network card so its address never changes.

  **You'll know it worked when:** the server machine's IP address stays the same across reboots.

- [x] ✅ **Remote (off-WiFi) field access.** Tailscale and local IP methods were replaced by a robust zero-subscription Port Forwarding approach using Dynamic DNS. This ensures 100% ownership and zero ongoing fees.

---

## Phase 6 — Pre-launch verification (walk it like a real user)

Don't call it launched until you've done this end to end, on the real production database, not your dev one.

- [ ] 🧑 **Full admin walkthrough.** (20 min)
  1. Log in as `admin` / `admin`, confirm you're forced to set a new password.
  2. Create one real client, one real vehicle, one real technician (with a linked user account).
  3. Schedule a job for that client, assigning the vehicle and technician.
  4. Try scheduling a second job for the same vehicle on the same day — confirm you get the availability-conflict warning.
  5. Create a recurring job template for that client and click **Generate** — confirm real jobs appear in the jobs list.
  6. Check the alert bell in the header — confirm it's empty (or shows exactly what you'd expect).

  **You'll know it worked when:** every step above behaves the way the Administrator Manual describes, with no errors.

- [ ] 🧑 **Full field tech walkthrough, on an actual phone.** (10 min)
  1. On a phone, open `http://<your-ddns-url>:3000/field`. (Ensure port forwarding and DDNS are configured correctly on the office router).
  2. Log in as the technician you created above.
  3. Confirm their assigned job appears, log time against it, mark it complete.

  **You'll know it worked when:** the job shows as completed in the admin dashboard and inventory was deducted correctly.

- [ ] 🧑 **QuickBooks export walkthrough.** (5 min) From the Accounting tab, export the invoice and time CSVs, open them, confirm the data looks right, then use "Mark Synced." Confirm the sync-lock is irreversible as expected (that's by design).

  **You'll know it worked when:** the CSVs contain the job you just completed, and re-exporting no longer includes it.

---

## Phase 7 — After launch

- [ ] 🧑 **Set up regular database backups.** (5 min) This is the single most important post-launch step — if this database is lost with no backup, you lose every job, client, and time record. The app has this built in: **Settings → Database Backup & Recovery**, set a **Target Directory Mirror** (an external drive, NAS, or synced folder like OneDrive/Google Drive). Once configured, a nightly `pg_dump` runs automatically at 2:00 AM (`electron/backup.js`); use "Run Backup Now" to test it immediately.

  **You'll know it worked when:** you have at least one backup file sitting somewhere other than the server machine's C: drive, dated within the last 24 hours.

- [ ] 🧑 **Know where to look when something breaks.** (5 min, just awareness) There's no error-tracking service (like Sentry) wired up — for a small internal tool that's a reasonable choice, not a gap that needs fixing right away. When something goes wrong: check the Electron app's console (or PM2 logs via `pm2 logs whitevanops` for the field-tech server), and check the **Audit Log** — every create/update/delete is recorded against the user who did it, which is usually enough to reconstruct what happened.

- [ ] 🧑 **Tell office staff the "Unknown Publisher" warning is expected**, and share the office server's IP with field techs so they can bookmark the field login page on their phones.

---

## Recommended first step

Phase 0 is done. Next up: **Phase 1** — decide which office machine is the permanent server, since every later step (secrets, database, install, field access) depends on that decision.
