# Client-Owned Standalone Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each paid install truly standalone (client-owned Cloudflare account + domain), starting with the only in-repo code the design touches — the field-access URL handling — and sequencing the ops/provisioning work behind the manual Phase 1 tunnel PoC.

**Architecture:** The design (`docs/superpowers/specs/2026-07-21-client-owned-standalone-connectivity-design.md`) is predominantly an onboarding/ops change: paid customers own their Cloudflare account and a dedicated cheap domain, handed over via an "Independence Packet." Only one slice is buildable and testable in-repo today — stripping the obsolete port-forward/DDNS assumptions out of the Field Access QR flow. Everything else depends on the exact commands the manual Phase 1 PoC pins down and is therefore listed as a gated roadmap, not fabricated steps.

**Tech Stack:** Next.js 16 App Router · TypeScript · React 19 · Vitest (node env, pure-logic tests in `src/lib/`) · `cloudflared` (ops, out of code scope) · Cloudflare Registrar/API (ops).

## Global Constraints

- **Tests run under Vitest in the `node` environment** — there is no jsdom/component harness. Testable logic must live as pure functions in `src/lib/` and be tested there; React components are verified via `npx tsc --noEmit` + `npm run build`, matching every existing test in the repo.
- **`@/` resolves to `src/`** (`vitest.config.ts`).
- **No `console.log` in production code.**
- **Immutable updates only; explicit types on exported functions** (repo coding-style rules).
- **Hostname scheme is settled:** flat `<customer>.whitevanops.com` for the trial track, `app.<theirdomain>.com` for client-owned. The public URL never contains `:3000`.
- **Manual-update policy:** user-facing behavior changes require updating the relevant `MANUAL_*.md` — but the field-access manual rewrite is explicitly deferred to the parent spec's Phase 4 (post-PoC), so Task 1 below updates only the in-component copy, not the manuals.

---

## Task 1: Field-access URL classification helper (extract + test)

Extract the URL-shape logic currently inlined in `FieldAccessModal.tsx` into a pure, tested helper, so the tunnel/HTTPS-aware behavior has real unit coverage in the repo's node-env test suite.

**Files:**
- Create: `src/lib/fieldAccessUrl.ts`
- Test: `src/lib/fieldAccessUrl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `classifyFieldUrl(url: string): FieldUrlClassification` where
  `interface FieldUrlClassification { isLocalhost: boolean; isPlainHttp: boolean; isHttps: boolean }`.
  `isLocalhost` = URL host is `localhost`/`127.0.0.1` (either scheme). `isHttps` = `https://` scheme.
  `isPlainHttp` = `http://` scheme **and not** localhost (i.e. plaintext over a public hop).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/fieldAccessUrl.test.ts
import { describe, expect, test } from "vitest";
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";

describe("classifyFieldUrl", () => {
  test("https tunnel URL is https, not localhost, not plain http", () => {
    expect(classifyFieldUrl("https://acme.whitevanops.com/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: false,
      isHttps: true,
    });
  });

  test("client-owned https URL classifies as https", () => {
    expect(classifyFieldUrl("https://app.acmevans.com/field").isHttps).toBe(true);
  });

  test("http localhost is localhost, not plain-http-public", () => {
    expect(classifyFieldUrl("http://localhost:3000/field")).toEqual({
      isLocalhost: true,
      isPlainHttp: false,
      isHttps: false,
    });
  });

  test("127.0.0.1 counts as localhost", () => {
    expect(classifyFieldUrl("http://127.0.0.1:3000/field").isLocalhost).toBe(true);
  });

  test("public plain http is flagged as plain http, not https", () => {
    expect(classifyFieldUrl("http://acme.duckdns.org:3000/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: true,
      isHttps: false,
    });
  });

  test("scheme match is case-insensitive", () => {
    expect(classifyFieldUrl("HTTPS://acme.whitevanops.com/field").isHttps).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fieldAccessUrl`
Expected: FAIL — `Failed to resolve import "@/lib/fieldAccessUrl"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/fieldAccessUrl.ts
export interface FieldUrlClassification {
  /** Host is localhost / 127.0.0.1 — unreachable from a phone. */
  isLocalhost: boolean;
  /** Plain http:// over a public host — credentials would travel unencrypted. */
  isPlainHttp: boolean;
  /** https:// — the shape the tunnel produces. */
  isHttps: boolean;
}

/**
 * Classifies a Field Module URL by transport shape so the QR flow can guide
 * the admin. The tunnel (trial or client-owned) always yields an https URL
 * with no :3000; localhost is never phone-reachable; public plain http means
 * plaintext credentials.
 */
export function classifyFieldUrl(url: string): FieldUrlClassification {
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isHttps = /^https:\/\//i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;
  return { isLocalhost, isPlainHttp, isHttps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fieldAccessUrl`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fieldAccessUrl.ts src/lib/fieldAccessUrl.test.ts
git commit -m "feat: extract tested field-access URL classifier"
```

---

## Task 2: Point FieldAccessModal at the helper and modernize its copy

Replace the inline regexes with `classifyFieldUrl`, drop every `duckdns.org:3000` / port-forward assumption, and rewrite the guidance for the tunnel model (public URL is `https://…/field`, no `:3000`; plain http is now a real warning, not "fine").

**Files:**
- Modify: `src/components/modals/FieldAccessModal.tsx`

**Interfaces:**
- Consumes: `classifyFieldUrl` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper and replace the inline regexes**

In `src/components/modals/FieldAccessModal.tsx`, add to the imports:

```tsx
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";
```

Replace these two lines:

```tsx
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;
```

with:

```tsx
  const { isLocalhost, isPlainHttp } = classifyFieldUrl(url);
```

- [ ] **Step 2: Update the doc comment (drop the DDNS framing)**

Replace the block comment above the component (lines ~14–24) with:

```tsx
/**
 * Shows a QR code pointing at the field module so techs can scan it with
 * their phone camera and install /field as a home-screen app. The URL is
 * persisted server-side (SystemSetting), not just this browser's
 * localStorage — otherwise a fresh browser/profile/device falls back to
 * `window.location.origin`, which on the Electron desktop app is always
 * `http://localhost:3000` and produces a QR code that only "works" on the
 * machine running the dashboard, never on a phone (ERR_CONNECTION_FAILED).
 * Field access is served over an HTTPS tunnel, so the working shape is
 * `https://<customer-host>/field` with no port. QR generation is refused
 * while the URL is localhost so a broken code is never handed to a tech.
 */
```

- [ ] **Step 3: Update the input placeholder**

Replace:

```tsx
          placeholder="http://your-client.duckdns.org:3000/field"
```

with:

```tsx
          placeholder="https://acme.whitevanops.com/field"
```

- [ ] **Step 4: Rewrite the localhost warning copy**

Replace the `isLocalhost` warning paragraph (the `<p>` block) with:

```tsx
        <p className="text-[11px] text-red-600 leading-relaxed font-medium">
          This is a localhost address — a phone scanning it will get
          &quot;localhost is unreachable,&quot; not the field module. Enter
          the tunnel address instead (e.g.{" "}
          <span className="font-mono">https://acme.whitevanops.com/field</span>
          ) — the QR code below is disabled until this is fixed.
        </p>
```

- [ ] **Step 5: Rewrite the plain-HTTP warning copy (no longer "fine")**

Replace the `isPlainHttp` warning paragraph with:

```tsx
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is a plain <span className="font-mono">http://</span> address —
          credentials would travel unencrypted over the public internet. Field
          access is served over an HTTPS tunnel; use the{" "}
          <span className="font-mono">https://</span> address so logins are
          encrypted and the session cookie is accepted.
        </p>
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds (no reference to the removed regexes; `classifyFieldUrl` resolves).

- [ ] **Step 7: Grep to confirm the obsolete model is gone**

Run: `git grep -n "duckdns" src/`
Expected: **no matches** in `src/` (the modal no longer mentions it).

- [ ] **Step 8: Commit**

```bash
git add src/components/modals/FieldAccessModal.tsx
git commit -m "refactor: field-access modal uses tunnel HTTPS model, drops DDNS assumptions"
```

---

## Sequenced roadmap (gated on the manual Phase 1 PoC — NOT executable as code yet)

These are the remaining spec deliverables. They are **deliberately not written as bite-sized
TDD steps** because their exact content depends on what the human-in-the-loop Phase 1 tunnel
PoC proves. Each becomes its own plan (or an appendix to this one) once the PoC pins the
commands down. Listed here so the full sequence is visible.

- **R0 — Prerequisite: finish the manual Phase 1 tunnel PoC.** User-led; runbook exists at
  `docs/superpowers/plans/2026-07-20-phase-1-tunnel-runbook.md` (currently at Step 4). Produces
  the *actual* working `cloudflared` create/route/service commands. Everything below depends
  on it.

- **R1 — Parameterized provisioning script + tunnel diagnostic.** Re-scope of parent spec
  Phase 2. One script keyed by `{ account, zone, hostname, track }` with `--trial` (vendor
  account) and `--client` (client-owned account) modes, plus a one-command "is the tunnel up?"
  diagnostic that reports which account/zone the live tunnel belongs to. Plan this after R0
  captures the real command shapes; the diagnostic is the testable core.

- **R2 — Independence Packet + one-page recovery runbook + reuse-domain appendix.**
  Customer-facing docs. The packet is a checklist (account owner confirmed theirs, domain
  confirmed theirs, recovery runbook attached, "move to your own domain later" appendix). The
  recovery runbook's exact rotate-token / re-point-tunnel commands come from R0/R1 — do not
  draft them speculatively.

- **R3 — Manual + `CLAUDE.md` updates (two-track field-access architecture).** Fold into the
  parent spec's Phase 4 doc rewrite; describe trial vs paid tracks, client-owned ownership, and
  the removal of the port-forward/DDNS model. Re-render the banner-flagged
  `MANUAL_White_Glove_Installation.html`.

- **R4 — Verification: the vendor-independence drill.** On a real fresh client-owned account,
  execute the recovery runbook using only the client's own Cloudflare + registrar logins + the
  office PC — no vendor-held credential. This is the test that proves "standalone," per the
  spec's verification criteria. Requires a real account; cannot be automated in this repo.

---

## Self-Review

- **Spec coverage:** App-side change (spec "App-side changes") → Tasks 1–2. Provisioning
  automation → R1. Independence Packet / recovery runbook / reuse-domain appendix → R2. Manual
  updates → R3. Verification criteria (incl. vendor-independence drill) → R4. Two-track model
  and dedicated-domain rationale are architecture/ops, realized across R0–R4. No spec section
  is unaccounted for; the split between "buildable now" (1–2) and "PoC-gated" (R0–R4) is stated
  explicitly.
- **Placeholder scan:** Tasks 1–2 contain complete code and exact commands. The roadmap items
  are intentionally spec-level, not fake steps — flagged as such, not presented as executable.
- **Type consistency:** `classifyFieldUrl` / `FieldUrlClassification` names and the
  `{ isLocalhost, isPlainHttp, isHttps }` shape are identical in Task 1 (definition), Task 1
  tests, and Task 2 (consumption via destructuring `{ isLocalhost, isPlainHttp }`).
