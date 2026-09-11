# Handoff — 2026-09-11: v2.0 shipped (docs phase) — one product, WiFi-only sync, export/import recovery

## Where this picks up

This was Phase 7 — the final phase — of a 7-phase WhiteVanOps v2.0 plan, built across multiple
background sessions/agents (context/rate-limit constraints meant no single session carried the
whole effort). Phases 1–6 built the actual v2.0 architecture; this phase was documentation-only,
updating `CLAUDE.md`, all three manuals, and the business/status docs to match. No source code
changed in this phase.

## What v2.0 shipped

**One product.** The Base/Plus tier is gone entirely — `License.tier`, `hasPlusLicense()`,
`requirePlus()`, the two-installer-per-platform split, all removed. Every activated install now
runs the full feature set: CRM notes/follow-ups, Analytics, Invoicing, Quoting, and the custom
Report Builder (the last one landed via the merged `feat/macos-support` branch alongside this
work and was never tier-gated to begin with). Activation itself — a signed `license.json`,
machine binding, the 30-day trial mechanism — is unchanged; only the tier concept inside it is
gone. There is exactly one installer per platform now:
`WhiteVanOps-Setup.exe`/`WhiteVanOps-Trial-Setup.exe` (Windows),
`WhiteVanOps-Setup-{arm64,x64}.dmg`/`WhiteVanOps-Trial-Setup-{arm64,x64}.dmg` (macOS).

**WiFi-only sync, permanently.** The Cloudflare tunnel (and, before it, the earlier Port
Forwarding + Dynamic DNS path) is completely removed — no `cloudflared` binary, no tunnel
runbook, no remote/cellular access story anywhere in the app or its docs. The field module
(`/field`) is reachable only on the office LAN or via `localhost`. `fieldUrlVerdict()` in
`src/lib/fieldAccessUrl.ts` now returns one of three values — `"localhost"`, `"ok-lan"`,
`"not-lan"` — with no tier branch.

**Quotes are PDF-only.** The public customer-facing approval route
(`/api/public/quotes/[token]`, `/quote/[token]`, `Quote.publicToken`) is removed — it depended on
the tunnel to be reachable off-LAN, which no longer exists. This was also the app's only
unauthenticated data surface; removing it means there is now none. The operator marks a Sent
quote Accepted/Declined by hand from the Quotes tab — that control already existed as the
phone/in-person fallback, and is now the only path. `canRespondToQuote()` in `src/lib/quote.ts`
still gates it.

**New field-write architecture (idempotency + authorization).** `POST /api/field/ops` replaces
the old split across `POST /api/time` and `PUT /api/jobs`. Every write carries a client-generated
`opId` (`src/lib/opId.ts`, ULID-shaped, built with `crypto.getRandomValues()` rather than
`crypto.randomUUID()` because the latter needs a secure context unavailable on the plain-http LAN
origin). `src/lib/fieldOps.ts` holds the four appliers (`logTime`, `setJobNotes`,
`setJobLineItems`, `setJobStatus`), each idempotent via a new `AppliedOp` table and an ordering
guard (`src/lib/opOrdering.ts`) for replace-semantics writes. This fixed a real, previously-live
bug: techs could not actually save job notes or materials before v2.0 (the old route 403'd those
fields for tech role, and that 403 was misclassified as an auth failure that halted the *entire*
offline sync queue — one bad write blocked everything queued behind it). `classifyRejection()` in
`src/lib/offlineWrite.ts` now correctly separates a 403 (permanent, job-specific — quarantines,
drain continues) from a 401 (real expired session — halts the drain). IndexedDB moved to schema
v4, adding a 30-day `history` store of synced ops.

**Export/import recovery**, a genuinely new feature: a tech can export a JSON snapshot of their
queued, stuck, and recently-synced work from `/field` at any time (export button next to Refresh;
`src/lib/fieldExport.ts`'s `buildExport()`, with a non-cryptographic FNV-1a checksum for
corruption detection, not tamper-proofing). An admin/superuser imports it back in from
**Settings → Recover Field Work** (`src/components/settings/RecoverFieldWorkSection.tsx` +
`POST /api/field/import`). Re-importing the same file twice is a guaranteed no-op — every op's
own `AppliedOp` row makes a repeat apply do nothing.

**Docs updated to match** (this phase): `CLAUDE.md`, `MANUAL_Setup_Installation.md`,
`MANUAL_Administrator.md`, `MANUAL_Field_Tech.md`, `PROJECT_STATUS.md`,
`docs/BUSINESS_Purchase_to_Install_Playbook.md`, `docs/launch-checklist.md`,
`docs/MANUAL_Troubleshooting.md`. Historical phase logs and dated design-spec references were
left as accurate history rather than rewritten — only present-tense claims were corrected.

## What was deliberately left out of scope

During planning, several alternatives to WiFi-only + export/import were considered and rejected
in favor of the simpler design that shipped:

- **Email-based sync** (a tech emails their queued work, office imports it) — rejected as strictly
  worse than the export/import feature that shipped: same manual-handoff shape, but with an extra
  dependency (a mail client configured on the tech's phone) and no improvement in reliability.
- **A vendor-hosted relay/store-and-forward service** — rejected because it reintroduces exactly
  the kind of ongoing infrastructure/subscription cost and second point of failure the tunnel
  removal was meant to eliminate, and because it would have meant customer data transiting a
  server this business doesn't control.
- **A native mobile app (React Native/Capacitor wrapper)** — considered, rejected as disproportionate
  to the problem; the PWA-in-browser approach plus export/import solves the actual failure mode
  (a tech briefly out of range or a phone that gets reset) without a second codebase to maintain.

## What's NOT yet done — nothing in this v2.0 effort has been run

**This is the most important thing for the next session or the owner to know: nothing in the
entire v2.0 effort has been manually tested in a running app or on a real phone.** Every one of
the seven phases was verified via `tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build`
only, plus manual code review of the trickiest parts (the `AppliedOp` P2002 duplicate-transaction
handling in `fieldOps.ts`, and the stateful double-import test for export/import recovery). No
live app was ever run against a live database, and no phone ever touched the field module during
this work.

### Before shipping v2.0, manually verify:

1. **Full tier removal, end to end.** Log in as admin/superuser and confirm every tab (CRM,
   Analytics, Quotes, Invoicing, Reports) is visible with no license/plan row anywhere that still
   special-cases anything. Check Settings → License & Plan specifically — it should show only an
   activation key and (for a trial) days remaining, nothing about a plan.
2. **Fresh activation.** Activate a brand-new install with a real key from
   `node scripts/license-manager.js` and confirm no tier prompt or plan-selection screen appears
   anywhere in the flow.
3. **The field-write bug fix, on a real phone, on the office WiFi.** Sign in as a tech account and
   confirm all three of: logging time, saving notes, saving materials actually succeed and show up
   on the dashboard. This was a real, live bug before v2.0 (techs silently couldn't save notes or
   materials) — the fix is architecturally sound and unit-tested, but has never been confirmed on
   real hardware.
4. **Offline → export → resync.** Walk a phone out of WiFi range, make some changes (time, notes,
   materials), use the **Export** button, walk back into range, and confirm the queue drains
   normally with no errors.
5. **Re-import the same export file.** On the desktop, import that same exported file via
   Settings → Recover Field Work and confirm it reports everything as "already applied" — no
   duplicate time entries, no duplicate materials, nothing double-counted.
6. **Manual quote decision.** Confirm a Sent quote can be marked Accepted or Declined manually from
   the Quotes tab, and confirm there is no remaining trace of the old public approval link
   anywhere in the UI (no "copy link" button, no "Accept Online" text on the PDF, etc.).
7. **A real Windows build.** Run `npm run electron:build` and confirm exactly one installer
   artifact is produced (`WhiteVanOps-Setup.exe`), and that there is no `cloudflared` anywhere in
   the unpacked output (`dist-electron/win-unpacked/resources/`).

None of the above is optional before this reaches a real customer — the doc updates in this
phase describe the intended behavior, not confirmed behavior.

## Next session should

1. Get on a machine that can run the full app (Electron dev or a packaged build) with a real
   database, and ideally a phone on the same WiFi network.
2. Work through the seven verification items above in order — they're roughly cheapest-first.
3. Fix whatever the manual pass turns up before this goes to a customer; nothing here has field
   experience behind it yet.
4. Once verified, this is the point where `main` (if the v2.0 work landed on a branch — check
   `git log`/`git branch` for where this actually sits) should be brought up to date and a real
   Windows + macOS installer pair built for distribution.
