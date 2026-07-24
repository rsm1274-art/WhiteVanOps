# WiFi Sync on Base, Tunnel on Plus (Design)

**Date:** 2026-07-24
**Status:** Design approved, pending implementation plan
**Supersedes in part:** `2026-07-20-cgnat-tunnel-connectivity-design.md` and
`2026-07-21-client-owned-standalone-connectivity-design.md` — both assumed the tunnel is the
universal field-access transport for *every* install. It is now a Plus-only capability. Their
tunnel mechanics, Independence Packet, and client-owned provisioning tracks are unchanged and
still govern Plus.
**Surfaces:** `/field` (tech), dashboard Field Access modal (admin), installers, marketing site

---

## Problem

Field access is currently one transport for one product. Every install — regardless of what the
customer paid — is expected to reach the office server through a Cloudflare tunnel. That couples
the cheap plan to a third-party dependency, a domain registration, and a guided onboarding
session, for a customer who may only ever need their techs' phones to hand work back at the end
of the day.

Splitting the transport by plan gives Base a genuinely self-contained story (nothing leaves the
building, no accounts, no domain, no recurring cost) and makes remote access the concrete thing
Plus sells beyond its three feature modules.

## Goals

- Base syncs field work over the local network only. A Base install cannot open a tunnel.
- Plus keeps the tunnel, unchanged from the two specs above.
- Four installers: Base, Plus, Base trial, Plus trial.
- No upgrade-in-place path. Base → Plus is a new purchase at a 25% discount and a Plus install.
- The website states the transport difference and the new prices.

## Non-goals

- Automated `cloudflared` provisioning. It stays the manual runbook (parent spec Phase 2).
- The client-owned mesh-VPN "maximum sovereignty" tier.
- Dashboard caching / optimistic UI (the parent spec's ~25-user ceiling — separate work).
- Any change to which *feature modules* each plan includes. The eight Base modules and three
  Plus modules are untouched.

---

## Decision: entitlement from the signed key, payload difference is physical

Base and Plus differ in exactly two observable ways:

| | Base | Plus |
|---|---|---|
| Entitlement | signed key's `tier` is `base` | signed key's `tier` is `plus` |
| `cloudflared` on disk | absent | bundled via `extraResources` |
| Field URL guidance | LAN address is correct; public host warns | tunnel hostname is correct |

A Base install cannot tunnel for two independent reasons — no entitlement **and** no binary.
Neither is a file anyone can edit.

**No new tunnel setup/health UI is built here.** The tunnel remains runbook-provisioned (see
Non-goals), so the only tunnel-aware app surface is the Field URL setting and its plan-aware
messaging below. The payload difference is purely the `cloudflared` binary.

`hasPlusLicense()` remains the single source of entitlement. **No new env var, no new DB column,
no new signed field in the activation key.** This is the load-bearing constraint: `WVO_DEFAULT_TIER`
was removed on 2026-07-15 because a plain-text line in `resources/nextjs/.env.local` granted the
paid tier, and it defeated the anti-tamper self-heal by making `verifiedPlus` true. Every branch
that can set `verifiedPlus` must stay gated on a signature. This design adds no branch that isn't.

### Options rejected

- **Compile the tunnel UI out of the Base bundle.** A build-time constant would tree-shake the
  tunnel screens so Base's JS genuinely lacks them. Rejected: it needs two full `next build` runs
  (doubling build time and the step-6/7b/7c assertion surface) and introduces a build flag that
  could drift into being a grant. Present-but-gated React costs nothing real on an install with
  no `cloudflared` binary and no Plus key.
- **Transport as its own signed capability, independent of tier.** Would allow selling remote
  access as a standalone add-on later. Rejected as YAGNI: a new signed field, a new minting flag,
  and a fourth precedence branch in `getLicense()` for a product not being sold.
- **Keep one installer and gate only at runtime.** Rejected by the goal: the Base artifact must
  not contain the tunnel binary, so the payloads genuinely differ.

---

## Field URL classification

`src/lib/fieldAccessUrl.ts` (already a tested leaf module) gains private-LAN detection and a
verdict function, replacing the ad-hoc boolean chains currently inline in the modal's JSX.

`FieldUrlClassification` gains `isPrivateLan` — RFC1918 literals (`10/8`, `172.16/12`,
`192.168/16`) plus `*.local` mDNS names.

```ts
type FieldUrlVerdict =
  | "ok-lan"              // private LAN address — correct on both plans
  | "ok-tunnel"           // https public host, remote access licensed
  | "localhost"           // unreachable from a phone — QR withheld
  | "remote-needs-plus"   // public host on Base — warn, but allow
  | "public-plain-http";  // public http on Plus — credentials in the clear

fieldUrlVerdict(url: string, remoteLicensed: boolean): FieldUrlVerdict
```

| URL shape | Base | Plus |
|---|---|---|
| `http://localhost:3000/field` | `localhost` | `localhost` |
| `http://192.168.1.20:3000/field` | `ok-lan` | `ok-lan` |
| `https://app.acme.com/field` | `remote-needs-plus` | `ok-tunnel` |
| `http://app.acme.com/field` | `remote-needs-plus` | `public-plain-http` |

The verdict is a **code, not a sentence**: copy stays in the component, the decision table stays
unit-testable. QR generation is withheld for `localhost` only — non-LAN on Base warns clearly but
is still allowed, so a customer with a working self-built arrangement is not stranded.

This also fixes a live bug. Today `isPlainHttp` fires an amber "credentials would travel
unencrypted over the public internet" warning on any `http://` non-localhost URL — including
`http://192.168.1.20:3000/field`, which on Base is the single correct answer. The warning is
wrong on a LAN and would train admins to ignore it.

`FieldAccessModal` takes an `isPlusLicensed` prop from `src/app/page.tsx`; `/api/dashboard`
already returns `license.plus`, so no new API is needed for this.

---

## Stable LAN addressing

A tunnel hostname is stable. A LAN IP is not. If the office router reboots and hands the server a
different address, every tech's saved home-screen PWA URL dies at once, with no error an admin
would recognise as an addressing problem. Base needs two supports it did not before:

1. **`GET /api/field-access/lan-address`** — admin/superuser, returns the server's non-loopback
   IPv4 addresses from `os.networkInterfaces()`. Surfaced in `FieldAccessModal` as a *"Use
   detected address"* button, so the admin never types the address and the QR cannot be built
   from a typo.
2. **A DHCP reservation or static IP** for the office PC, documented as a **required** Base setup
   step in `MANUAL_Setup_Installation.md`.

Without both, Base field access breaks silently on a router reboot, which reads to a customer as
"the cheap plan is flaky."

---

## Field sync status

The offline machinery already exists and is unchanged: `src/lib/idb.ts` (`syncQueue`, `stuckOps`),
`src/lib/offlineWrite.ts` (`submitWrite`, `drainSyncQueue`, `classifyRejection`),
`src/lib/syncResolution.ts`, and the shipped `StuckOpsPanel`. Writes queue on request failure —
not on radio state — and drain on mount and on `online`. On the office WiFi that already *is*
WiFi sync.

What is missing is honesty about state. `src/app/field/page.tsx:973` renders an amber
**"Syncing…"** badge whenever the queue is non-empty and `isOnline` is true. A Base tech off-site
all day has full signal and an unreachable office server, so the badge reads "Syncing…"
indefinitely while nothing syncs — the same `navigator.onLine` confusion the 2026-07-15 work was
paid to remove, now sitting directly on top of Base's core promise.

`pendingSync: boolean` becomes `pendingCount: number`, and status is derived from the count plus
the last `DrainResult.stopped`:

| Condition | Shown |
|---|---|
| queue empty | nothing, plus "Last saved to office: 2:14pm" |
| draining now | "Syncing 3…" |
| `stopped === "unreachable"` | **"3 waiting · office network not found"** + *Try now* button |
| `stopped === "auth"` | existing re-login toast path (never a stuck record) |
| `stopped === "retry"` | "3 waiting · office server busy" + *Try now* |

`lastSyncedAt` persists in **`localStorage`**, not IndexedDB, so a tech can confirm their week
actually landed. `idb.ts` has exactly three stores (`apiCache`, `syncQueue`, `stuckOps`) and no
metadata store; adding one would mean `DB_VERSION` 2 → 3, and the 1 → 2 upgrade against a device
holding queued work is the single thing the 2026-07-15 spec singled out as worth browser-verifying
rather than trusting. A cosmetic "last saved" timestamp does not justify touching that path.
`localStorage` is already the pattern for small display values here (`wvo.fieldAccessUrl`), and if
it is ever cleared the consequence is one missing timestamp, never a lost write.

The derivation is pure logic in a new `src/lib/syncStatus.ts`:

```ts
deriveSyncStatus(input: {
  pendingCount: number;
  isDraining: boolean;
  lastStop: DrainResult["stopped"] | null;
  lastSyncedAt: number | null;
}): SyncStatus   // discriminated union
```

Unit-tested; `page.tsx` stays thin wiring, consistent with `vitest.config.ts`'s
`environment: "node"` and `include: ["src/**/*.test.ts"]`.

*Try now* calls the existing `processSync()`. It adds no new transport — it only lets a tech ask
rather than wait, which matters when the answer is "you are not on the office network yet."

### In-scope cleanup

`src/app/field/page.tsx` is 1091 lines against the 800-line ceiling in the coding-style rules, and
this work edits it. Extract two already-self-contained pieces, with no behaviour change:

- `StuckOpsPanel` → `src/components/field/StuckOpsPanel.tsx`
- the new status strip → `src/components/field/SyncStatusBar.tsx`

---

## Trial plan, signed

`getLicense()` currently forces Plus for any trial build with no base licence
(`src/lib/license.ts:234`). A Base trial must force Base. The obvious implementation — a
`WVO_TRIAL_PLAN=base` line in the bundled `.env.local` — is precisely the `WVO_DEFAULT_TIER` hole
again: one word in Notepad grants the paid tier.

So the stamp is signed:

- `src/lib/licenseCrypto.ts` gains `signTrialPlan(plan)` / `verifyTrialPlan(plan, sig)` — HMAC over
  `trial-plan:${plan}` under `LICENSE_SIGNING_SECRET`, timing-safe compare, alongside the existing
  helpers. It is the right home: the leaf module both `license.ts` and `trial.ts` already import.
- `electron-build.js --trial --plan base|plus` writes `WVO_IS_TRIAL=true`, `WVO_TRIAL_PLAN=<plan>`,
  and `WVO_TRIAL_PLAN_SIG=<sig>` into the bundled `.env.local`.
- The trial branch of `getLicense()`'s precedence chain honours `plus` **only** when the signature
  verifies. Missing, edited, or unsigned → **`base`**.

**Fail closed to the lesser plan.** Tampering can only ever cost features, never grant them. This
keeps the invariant the tier-precedence chain maintains: configuration alone never grants Plus.

The `trial-unlock.json` branch still outranks the trial plan, so a paid day-30 conversion continues
to decide the plan from the unlock key's own tier — a base-tier unlock correctly drops Plus.

**Accepted consequence:** any Plus trial installer already distributed carries no stamp, so on next
launch it fails closed to Base features (still 30-day locked). Trials are disposable demos and both
trial artifacts are rebuilt here.

---

## Installer matrix

| npm script | args | artifact | `cloudflared` | tier from |
|---|---|---|---|---|
| `electron:build` | `--base` | `WhiteVanOps-Base-Setup.exe` | absent | signed key |
| `electron:build:plus` | `--plus` | `WhiteVanOps-Plus-Setup.exe` | bundled | signed key |
| `electron:build:trial` | `--trial --plan base` | `WhiteVanOps-Base-Trial-Setup.exe` | absent | signed stamp |
| `electron:build:trial:plus` | `--trial --plan plus` | `WhiteVanOps-Plus-Trial-Setup.exe` | bundled | signed stamp |

`--plan` is **required** with `--trial` — no default, so a mis-typed command cannot ship a trial on
the wrong plan.

`package.json`'s `build` key stays the single source of truth. The script deep-clones it, applies
the variant delta, writes `.next/electron-builder.<variant>.json`, and calls
`electron-builder --win --config <that file>`. The delta is computed, never duplicated:

- `win.artifactName` per the table above.
- Plus variants only: one extra `{ "from": "cloudflared", "to": "cloudflared" }` entry appended to
  `win.extraResources`.

`cloudflared/cloudflared.exe` lives gitignored in the project root, exactly like `pgsql/`, with
recreation steps in `MANUAL_Setup_Installation.md`. Plus variants **hard-fail before packaging**
when it is absent, mirroring the existing `pgsql/bin/pg_ctl.exe` check.

**Step 7b asserts in both directions:**

- Plus artifacts: `win-unpacked/resources/cloudflared/cloudflared.exe` **exists**.
- Base artifacts: that path **does not exist**.

Both directions matter. electron-builder silently skips missing `extraResources` sources (which
once shipped a DB-less installer), so a Plus build can lose the binary without failing; and a Base
build that accidentally ships it erases the product boundary being sold.

The Base artifact renames from today's default `WhiteVanOps Setup <version>.exe`. With four
artifacts in `dist-electron/`, an unlabelled one is a mis-shipped install waiting to happen.

---

## Removing the upgrade model

Base → Plus is a new purchase at 25% off and a Plus install, not a patch.

**Deleted:**

- the `--upgrade` branch in `scripts/electron-build.js`
- `upgrade_installer.cs`
- the `electron:build:upgrade` npm script
- the `isPlus && !isUpgrade` hard-fail block (`--plus` is now a valid variant)

**Kept, read-only legacy** — with a dated comment saying no new patches are minted:

- `verifyPlusLicense()` and the `plus_license.json` branch in `src/lib/license.ts` (lines ~163-176
  and ~247)
- the `plus_license.json` paths in `src/app/api/license/route.ts`

This is the same courtesy the legacy `license.json` shape already gets: an install already patched
in the field keeps working rather than silently dropping to Base on next launch.

`scripts/license-manager.js --tier base|plus` is untouched — still how keys are minted.
`scripts/activate-dev.js` writes a dev `plus_license.json`; it keeps working but now exercises the
legacy path, and gains a comment saying so.

---

## Website

`marketing/index.html` **and** `marketing/AlternateWebsites/option-a-ledger.html` — the alternate
carries the same pricing cards (`$500` at line 568, `+$500` at 582, the upgrade subtitle at 583),
so the two must not disagree.

Feature sets are **not** changed. The eight-Base / three-Plus module split, every `fcard`, and the
"Eight modules on Base. Three more on Plus." headline stay exactly as they are. The transport
difference is expressed in the pricing-card bullets.

| Element | Change |
|---|---|
| Base card price | unchanged, `$500 one-time` |
| Base card bullets | add *"WiFi sync — techs' phones offload work on your office network."* |
| Plus card badge | remove `<span class="plus-badge">Upgrade</span>` |
| Plus card price | `$1,000 one-time` — replaces `+$500` and its "one-time upgrade to Base · $1,000 for a fresh Base + Plus install" subtitle |
| Plus card bullets | add *"Secure remote tunnel — encrypted field access from anywhere."* |
| Tier note | replace the "Base now, Plus when you're ready" upgrade pitch with two independent products + *"Already on Base? Move to Plus for 25% off — contact us."* No self-serve discounted figure. |
| `<meta name="description">` (line 7) | drops "upgrade to Plus for…" — it sells a path that no longer exists |
| Section-04 body copy (line 471) | drops "the three Plus cards are a paid upgrade you can add whenever your business is ready" |
| White Glove card | "Field-access router configuration" → field access setup covering office WiFi sync or the secure tunnel. Port forwarding was abandoned; the line advertises a service no longer performed. An add-on, not one of the two plans. |

---

## Docs

Per the manual policy in `CLAUDE.md`, these are part of the work:

- **`CLAUDE.md`** — needs real edits, not touch-ups. It currently asserts the opposite of this
  design in three places: *"Base and Plus are the SAME installer"* and "there is no `--plus` build
  target" in the License/Plus section; the `electron:build:*` command list; and the Transport
  paragraph describing the tunnel as the universal replacement for port forwarding.
- **`MANUAL_Setup_Installation.md`** — the four installers and their commands; recreating
  `cloudflared/`; Base LAN setup (detected address, DHCP reservation / static IP as required);
  delete the Plus Upgrade Installer section (§ referencing `plus_license.json` patching).
- **`MANUAL_Field_Tech.md`** — the sync status strip, what "office network not found" means, and
  *Try now*.
- **`MANUAL_Administrator.md`** — the Field Access modal's plan-aware messaging and *Use detected
  address*.
- **`MANUAL_Troubleshooting.md`** — "work isn't reaching the office" for Base: wrong LAN address
  after a router reboot, not on office WiFi, queue waiting.
- **`docs/launch-checklist.md`** — Phase 4 currently frames plain-HTTP field access as a temporary
  state pending the tunnel. On Base, LAN HTTP is now the permanent design.

---

## Testing

**Unit** (`src/lib/`, `environment: "node"`):

- `fieldUrlVerdict` — all five verdicts × both `remoteLicensed` values (the table above).
- `isPrivateLan` — boundaries matter: `172.15.x.x` and `172.32.x.x` must be **excluded**,
  `172.16.x.x` and `172.31.x.x` included; `10.x`, `192.168.x`, `*.local` included; public hosts and
  `169.254.x` (link-local) excluded.
- `deriveSyncStatus` — one case per row of the status table, including empty-queue-with-timestamp.
- `verifyTrialPlan` — valid signature, edited plan, absent signature, absent plan.
- **Regression test**, mirroring the existing `"ignores WVO_DEFAULT_TIER=plus and self-heals a plus
  DB row back to base"`: *"ignores an unsigned WVO_TRIAL_PLAN=plus and falls back to base."*

Existing conventions apply: mock `@/lib/db` in anything importing it, `vi.resetAllMocks()` in
`beforeEach`, `vi.stubEnv` over direct `process.env` assignment, and keep fake secret-shaped
fixtures short so `scripts/scan-secrets.js` does not trip.

**Build-level:** all four variants produce the named artifact, with `cloudflared` present in Plus
variants and absent in Base variants.

**Browser-verified** (not unit-testable): a Base install where a phone on office WiFi loads
`/field` from the detected LAN address, logs time, leaves the network, logs more work, returns, and
drains — with the status strip showing "waiting · office network not found" while away and clearing
on return. Plus the standing regression that **Electron login on `http://localhost:3000` still
works**, which the per-request cookie `secure` logic exists to protect.

---

## Verification criteria

Not complete until observed, not assumed:

- [ ] `npm test` and `npx tsc --noEmit` pass.
- [ ] All four installers build; artifact names match the matrix.
- [ ] `cloudflared.exe` present in both Plus artifacts, absent from both Base artifacts.
- [ ] A Base install's Field Access modal offers the detected LAN address, treats it as `ok-lan`
      with no warning, and generates a QR.
- [ ] The same modal on Base shows the "remote access needs Plus" notice for an `https://` public
      host — and still generates the QR.
- [ ] A phone on office WiFi loads `/field` from the LAN address, logs time; off-network writes
      queue and show "waiting · office network not found"; rejoining the WiFi drains them and
      updates "Last saved to office".
- [ ] Electron desktop login on `http://localhost:3000` still works.
- [ ] A Base trial install runs on Base features and locks at day 30.
- [ ] Editing `WVO_TRIAL_PLAN` to `plus` in a Base trial's `.env.local` grants nothing.
- [ ] `marketing/index.html` and the alternate both show Base $500 / Plus $1,000, no "Upgrade"
      badge, and the two new transport bullets.
- [ ] No `--upgrade` build target remains; an existing `plus_license.json` install still reads Plus.

---

## Risks

| Risk | Mitigation |
|---|---|
| Office PC's LAN IP changes; every tech's saved PWA URL dies at once | Detected-address button removes typos; DHCP reservation / static IP documented as a required Base setup step; Troubleshooting entry names this symptom first. |
| A Base artifact ships `cloudflared` and quietly erases the plan boundary | Step 7b asserts absence, not just presence — both directions. |
| `WVO_TRIAL_PLAN` becomes the next `WVO_DEFAULT_TIER` | The stamp is HMAC-signed and fails closed to `base`; a dedicated regression test guards it. |
| Already-distributed Plus trials fail closed to Base features | Accepted and documented above; trials are disposable and both trial artifacts are rebuilt. |
| A Base customer expects remote access because the old site implied one product | Website, both manuals, and the modal all state the transport difference explicitly. |
| Removing the upgrade patch strands an install already converted by one | The `plus_license.json` reader is deliberately kept as read-only legacy. |
