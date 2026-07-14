# Trial Installer: Skip Base Activation, Honor Unlocked Tier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trial/demo installs boot straight to password login with no native activation-key prompt, stay on Plus until the 30-day trial lock fires, and — when the customer unlocks with a base or plus key at day 30 — actually run at that unlocked tier's features.

**Architecture:** (1) Extract the shared HMAC signing/verification helpers that `license.ts` and `trial.ts` both need into a new leaf module `licenseCrypto.ts`, breaking a would-be import cycle. (2) Teach `getLicense()` to treat a validated `trial-unlock.json` as the highest-precedence tier source, ahead of the trial's pre-activated-Plus default. (3) Teach the Electron main process to detect a trial build and skip the native base-activation window entirely.

**Tech Stack:** TypeScript, Node `crypto` (HMAC-SHA256), Vitest, Electron main process (CommonJS `electron/main.js`).

## Global Constraints

- Password login is never modified — every phase of this feature is orthogonal to `src/app/api/auth/login/route.ts`.
- Base/Plus customer builds (non-trial) must be byte-for-byte unaffected: same activation window, same `getLicense()` output for every existing test.
- No new backwards-compatibility shims: refactor call sites directly rather than leaving re-export shims where the codebase doesn't already have one. The one intentional exception is `license.ts` re-exporting `LICENSE_SIGNING_SECRET` / `getAppDataWvoDir` from `licenseCrypto.ts`, because three other files (`src/app/api/license/route.ts`, `src/app/api/license/route.test.ts`, `src/lib/trial.test.ts`) already import those two names from `"./license"` / `"@/lib/license"` and there is no reason to touch those import lines.
- `dist-electron/` and `pgsql/` are gitignored — the final build-verification task produces no files to commit.
- Every new test file mocks `node-machine-id` and `@/lib/db` the same way the existing `license.test.ts` / `trial.test.ts` do, for any test that transitively imports `license.ts`. `licenseCrypto.ts` itself imports neither, so `licenseCrypto.test.ts` needs no mocks at all.

---

### Task 1: Create the shared `licenseCrypto` module

**Files:**
- Create: `src/lib/licenseCrypto.ts`
- Test: `src/lib/licenseCrypto.test.ts`

**Interfaces:**
- Produces (used by Task 2 and Task 3):
  - `export const LICENSE_SIGNING_SECRET: string`
  - `export function getAppDataWvoDir(): string`
  - `export function timingSafeEqualStrings(a: string, b: string): boolean`
  - `export interface TrialUnlockPayload { machineId: string; tier: "base" | "plus"; expiresAt: string | null; notes: string | null; sig: string; }`
  - `export function signTrialUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string`
  - `export function verifyTrialUnlock(payload: unknown, machineId: string): payload is TrialUnlockPayload`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/licenseCrypto.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { signTrialUnlock, verifyTrialUnlock, timingSafeEqualStrings } from "./licenseCrypto";

describe("timingSafeEqualStrings", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStrings("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqualStrings("abc123", "xyz789")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqualStrings("short", "a-much-longer-string")).toBe(false);
  });
});

describe("signTrialUnlock / verifyTrialUnlock", () => {
  it("verifies a correctly signed payload (round-trip)", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("verifies a payload with a non-null expiresAt", () => {
    const expiresAt = "2027-01-01T00:00:00.000Z";
    const sig = signTrialUnlock("test-machine-id", "base", expiresAt);
    const payload = { machineId: "test-machine-id", tier: "base" as const, expiresAt, notes: "note", sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("rejects a payload whose machineId does not match the caller's machine", () => {
    const sig = signTrialUnlock("other-machine", "plus", null);
    const payload = { machineId: "other-machine", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig: "bogus" };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects an invalid tier", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "enterprise", expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(verifyTrialUnlock(null, "test-machine-id")).toBe(false);
    expect(verifyTrialUnlock("a string", "test-machine-id")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/licenseCrypto.test.ts`
Expected: FAIL — `Cannot find module './licenseCrypto'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/licenseCrypto.ts`:

```typescript
import path from "path";
import os from "os";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Shared low-level crypto/paths for the license system. This is a leaf module —
// it must never import from license.ts or trial.ts, both of which import from
// here. (license.ts needs to verify trial-unlock.json to honor the unlocked
// tier; trial.ts already needed these; a license.ts <-> trial.ts import would
// cycle.)
// ---------------------------------------------------------------------------

export const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";

/** Resolves platform-specific AppData directory for WhiteVanOps */
export function getAppDataWvoDir(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support")
      : path.join(os.homedir(), ".config"));
  return path.join(appData, "whitevanops");
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export interface TrialUnlockPayload {
  machineId: string;
  tier: "base" | "plus";
  expiresAt: string | null;
  notes: string | null;
  sig: string;
}

/** Signs a trial-unlock payload. Used by tests and mirrored in scripts/license-manager.js for CLI key generation. */
export function signTrialUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${machineId}:${tier}:${expiresAt || ""}`)
    .digest("hex");
}

/** Verifies a pasted activation key against THIS machine's real ID — never the payload's claimed machineId. */
export function verifyTrialUnlock(payload: unknown, machineId: string): payload is TrialUnlockPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.machineId !== machineId) return false;
  if (p.tier !== "base" && p.tier !== "plus") return false;
  if (typeof p.sig !== "string") return false;
  const expiresAt = typeof p.expiresAt === "string" ? p.expiresAt : null;
  const expected = signTrialUnlock(machineId, p.tier, expiresAt);
  return timingSafeEqualStrings(p.sig, expected);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/licenseCrypto.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/licenseCrypto.ts src/lib/licenseCrypto.test.ts
git commit -m "feat: extract shared license signing helpers into licenseCrypto.ts"
```

---

### Task 2: Point `license.ts` at `licenseCrypto` (no behavior change)

**Files:**
- Modify: `src/lib/license.ts:1-51` (imports and local `LICENSE_SIGNING_SECRET`/`getAppDataWvoDir` definitions)

**Interfaces:**
- Consumes: `LICENSE_SIGNING_SECRET`, `getAppDataWvoDir` from `./licenseCrypto` (Task 1)
- Produces: `license.ts` still exports `LICENSE_SIGNING_SECRET` and `getAppDataWvoDir` (re-exported) — unchanged public API for `src/app/api/license/route.ts`, `route.test.ts`, `src/lib/trial.test.ts`, `src/lib/license.test.ts`.

This task is a pure refactor: delete the two local definitions, import + re-export the same names from the new module. Every existing test must still pass unmodified — that's the test for this task.

- [ ] **Step 1: Replace the top of `license.ts`**

In `src/lib/license.ts`, replace:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "./db";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

// ---------------------------------------------------------------------------
// License tier gating (Base vs Plus). Mirrors the requireRole shape in
// auth.ts: routes call `requirePlus(await hasPlusLicense())` alongside
// requireRole. The UI hiding Plus tabs is convenience only — every Plus API
// route must gate server-side with requirePlus.
// ---------------------------------------------------------------------------

export const LICENSE_ROW_ID = "singleton";
export const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";

export type LicenseTier = "base" | "plus";
```

with:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "./db";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import {
  LICENSE_SIGNING_SECRET,
  getAppDataWvoDir,
  verifyTrialUnlock,
  TrialUnlockPayload,
} from "./licenseCrypto";

// ---------------------------------------------------------------------------
// License tier gating (Base vs Plus). Mirrors the requireRole shape in
// auth.ts: routes call `requirePlus(await hasPlusLicense())` alongside
// requireRole. The UI hiding Plus tabs is convenience only — every Plus API
// route must gate server-side with requirePlus.
// ---------------------------------------------------------------------------

export { LICENSE_SIGNING_SECRET, getAppDataWvoDir };

export const LICENSE_ROW_ID = "singleton";

export type LicenseTier = "base" | "plus";
```

(`verifyTrialUnlock` and `TrialUnlockPayload` aren't used yet — they're wired up in Task 4. Importing them now avoids a second edit to this same import block.)

- [ ] **Step 2: Remove the now-duplicated `getAppDataWvoDir` function**

In `src/lib/license.ts`, delete this block (originally lines ~43-51):

```typescript
/** Resolves platform-specific AppData directory for WhiteVanOps */
export function getAppDataWvoDir(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support")
      : path.join(os.homedir(), ".config"));
  return path.join(appData, "whitevanops");
}

```

- [ ] **Step 3: Run the full existing license test suite to confirm no regression**

Run: `npx vitest run src/lib/license.test.ts src/app/api/license/route.test.ts src/lib/trial.test.ts`
Expected: PASS — all tests identical to before this task (this task changes no behavior, only where two symbols are defined).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `os` import removal didn't leave a dangling reference, and the re-export shape matches consumers).

- [ ] **Step 5: Commit**

```bash
git add src/lib/license.ts
git commit -m "refactor: license.ts sources signing secret and AppData path from licenseCrypto"
```

---

### Task 3: Point `trial.ts` at `licenseCrypto` (no behavior change)

**Files:**
- Modify: `src/lib/trial.ts` (whole file — imports, and remove the now-duplicated `timingSafeEqualStrings`, `signTrialUnlock`, `verifyTrialUnlock`, `TrialUnlockPayload`)
- Modify: `src/lib/trial.test.ts:133-156` (remove the `describe("verifyTrialUnlock / signTrialUnlock")` block — that logic is now tested in `licenseCrypto.test.ts`, Task 1)

**Interfaces:**
- Consumes: `getAppDataWvoDir`, `LICENSE_SIGNING_SECRET`, `timingSafeEqualStrings`, `signTrialUnlock`, `verifyTrialUnlock`, `TrialUnlockPayload` from `./licenseCrypto` (Task 1)
- Produces: `trial.ts` keeps its exact current public API — `getTrialStatus`, `verifyTrialUnlock`, `signTrialUnlock`, `markTrialUnlocked`, `TrialAnchor`, `TrialUnlockPayload`, `TrialStatus` — so `src/app/api/license/route.ts` and `src/lib/trial.test.ts` (minus the removed block) need no import changes.

- [ ] **Step 1: Replace the entire contents of `src/lib/trial.ts`**

```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import {
  getAppDataWvoDir,
  LICENSE_SIGNING_SECRET,
  timingSafeEqualStrings,
  signTrialUnlock,
  verifyTrialUnlock,
  TrialUnlockPayload,
} from "./licenseCrypto";

// ---------------------------------------------------------------------------
// Trial-lock for demo installers (WVO_IS_TRIAL=true builds only). Independent
// of the Base/Plus tier gate in license.ts: a trial install runs on Plus for
// 30 days from first launch, then locks the whole app regardless of tier,
// until a signed unlock key (see verifyTrialUnlock) is applied.
// ---------------------------------------------------------------------------

export { signTrialUnlock, verifyTrialUnlock };
export type { TrialUnlockPayload };

const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialAnchor {
  installedAt: string;
  machineId: string;
  sig: string;
}

export interface TrialStatus {
  isTrial: boolean;
  daysRemaining: number;
  isLocked: boolean;
  machineId: string | null;
}

function getTrialAnchorPath(): string {
  return path.join(getAppDataWvoDir(), "trial.json");
}

function getTrialUnlockPath(): string {
  return path.join(getAppDataWvoDir(), "trial-unlock.json");
}

function signAnchor(installedAt: string, machineId: string): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${installedAt}:${machineId}`)
    .digest("hex");
}

/** Writes trial-unlock.json. Its mere presence permanently defeats the trial lock. */
export function markTrialUnlocked(payload: TrialUnlockPayload): void {
  const dir = getAppDataWvoDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getTrialUnlockPath(), JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Reads (or lazily creates, mirroring getLicense()'s self-healing DB upsert)
 * the trial anchor and computes lock state. No-op for non-trial builds.
 */
export function getTrialStatus(now: Date = new Date()): TrialStatus {
  if (process.env.WVO_IS_TRIAL !== "true") {
    return { isTrial: false, daysRemaining: 0, isLocked: false, machineId: null };
  }

  const machineId = machineIdSync();

  if (fs.existsSync(getTrialUnlockPath())) {
    return { isTrial: true, daysRemaining: 0, isLocked: false, machineId };
  }

  try {
    const anchorPath = getTrialAnchorPath();
    let anchor: TrialAnchor;
    if (fs.existsSync(anchorPath)) {
      anchor = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
    } else {
      const installedAt = now.toISOString();
      anchor = { installedAt, machineId, sig: signAnchor(installedAt, machineId) };
      const dir = getAppDataWvoDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(anchorPath, JSON.stringify(anchor, null, 2), "utf8");
    }

    const sigValid = timingSafeEqualStrings(anchor.sig, signAnchor(anchor.installedAt, anchor.machineId));
    const elapsedMs = now.getTime() - new Date(anchor.installedAt).getTime();
    const daysRemaining = Math.max(0, Math.ceil((TRIAL_LENGTH_MS - elapsedMs) / (24 * 60 * 60 * 1000)));
    const isLocked = !sigValid || elapsedMs >= TRIAL_LENGTH_MS;

    return { isTrial: true, daysRemaining, isLocked, machineId };
  } catch {
    // Corrupt/unreadable anchor (truncated JSON, disk error, etc). Fail
    // closed rather than let this throw out of the login route and 500 every
    // login — a locked trial is safe; an unhandled exception is not.
    return { isTrial: true, daysRemaining: 0, isLocked: true, machineId };
  }
}
```

- [ ] **Step 2: Remove the redundant test block from `trial.test.ts`**

In `src/lib/trial.test.ts`, delete the entire `describe("verifyTrialUnlock / signTrialUnlock", ...)` block (originally lines 133-156):

```typescript
describe("verifyTrialUnlock / signTrialUnlock", () => {
  it("verifies a correctly signed payload", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(true);
  });

  it("rejects a payload signed for a different machine", () => {
    const sig = signTrialUnlock("other-machine", "plus", null);
    const payload = { machineId: "other-machine", tier: "plus" as const, expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const payload = { machineId: "test-machine-id", tier: "plus" as const, expiresAt: null, notes: null, sig: "bogus" };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });

  it("rejects an invalid tier", () => {
    const sig = signTrialUnlock("test-machine-id", "plus", null);
    const payload = { machineId: "test-machine-id", tier: "enterprise", expiresAt: null, notes: null, sig };
    expect(verifyTrialUnlock(payload, "test-machine-id")).toBe(false);
  });
});

```

Leave the `signTrialUnlock`, `verifyTrialUnlock` names in the top `import { getTrialStatus, verifyTrialUnlock, signTrialUnlock, markTrialUnlocked } from "./trial";` line alone — `markTrialUnlocked`'s test at the bottom of the file doesn't use them, but removing them from the import isn't necessary for this task (YAGNI: don't touch a working import line that costs nothing to leave).

- [ ] **Step 3: Run the trial test suite**

Run: `npx vitest run src/lib/trial.test.ts`
Expected: PASS — same `getTrialStatus` / `markTrialUnlocked` tests as before, minus the four removed cases now living in `licenseCrypto.test.ts`.

- [ ] **Step 4: Run the license + route test suites again (trial.ts is imported by route.ts)**

Run: `npx vitest run src/lib/license.test.ts src/app/api/license/route.test.ts`
Expected: PASS — unaffected by this task.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trial.ts src/lib/trial.test.ts
git commit -m "refactor: trial.ts sources shared crypto helpers from licenseCrypto"
```

---

### Task 4: Make `getLicense()` honor a validated trial-unlock as the tier source

**Files:**
- Modify: `src/lib/license.ts` (the `getLicense()` function body)
- Modify: `src/lib/license.test.ts` (extend the `"getLicense with cryptographic validation"` describe block)

**Interfaces:**
- Consumes: `verifyTrialUnlock`, `TrialUnlockPayload` from `./licenseCrypto` (already imported in Task 2), `getAppDataWvoDir` (already imported), `machineIdSync` (already imported).
- Produces: no new exports — this changes `getLicense()`'s internal precedence only. Its return type (`LicenseState`) is unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/lib/license.test.ts`, first update the `beforeEach` of the `"getLicense with cryptographic validation"` describe block (originally lines 153-158) to also clear env stubs between tests — needed because the new tests stub `WVO_IS_TRIAL` and `WVO_DEFAULT_TIER`:

Replace:

```typescript
describe("getLicense with cryptographic validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });
```

with:

```typescript
describe("getLicense with cryptographic validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
```

(Add `afterEach` to the top-level vitest import: change `import { describe, it, expect, vi, beforeEach } from "vitest";` to `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";`.)

Then add four new tests at the end of that same describe block, immediately before its closing `});` (i.e. right after the existing `"bypasses files and activates plus when WVO_DEFAULT_TIER environment variable is plus"` test):

```typescript
  it("a valid trial-unlock.json for tier 'plus' wins over the trial's pre-activated-Plus default", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    const expiresAt = "2027-06-01T00:00:00.000Z";
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`test-machine-id:plus:${expiresAt}`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "test-machine-id", tier: "plus", expiresAt, notes: "Converted to Plus", sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: null,
      notes: "Converted to Plus",
      activatedAt: new Date(),
      expiresAt: new Date(expiresAt),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(license.notes).toBe("Converted to Plus");
    expect(license.expiresAt?.toISOString()).toBe(expiresAt);
  });

  it("a valid trial-unlock.json for tier 'base' overrides the trial's pre-activated-Plus default and self-heals a tampered plus DB row", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update("test-machine-id:base:")
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "test-machine-id", tier: "base", expiresAt: null, notes: "Converted to Base", sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "base", activatedAt: null }),
      })
    );
  });

  it("with no trial-unlock.json, an unconverted trial build still forces plus", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_DEFAULT_TIER", "plus");

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "PRE-ACTIVATED-PLUS-BUILD",
      notes: "Activated via Plus Installer Build",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("plus");
    expect(license.notes).toBe("Activated via Plus Installer Build");
  });

  it("ignores a trial-unlock.json signed for a different machine and self-heals a tampered plus DB row to base", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    // WVO_DEFAULT_TIER intentionally left unset ("base") to isolate the
    // trial-unlock-ignored path from the separate unconverted-trial force.

    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update("some-other-machine:base:")
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => p.toString().endsWith("trial-unlock.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ machineId: "some-other-machine", tier: "base", expiresAt: null, notes: null, sig })
    );

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "plus",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.license.update).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: "WVO-KEY-123",
      notes: "Tampered Notes",
      activatedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const license = await getLicense();
    expect(license.tier).toBe("base");
    expect(prisma.license.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ROW_ID },
        data: expect.objectContaining({ tier: "base", activatedAt: null }),
      })
    );
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/lib/license.test.ts`
Expected: FAIL on the 4 new tests — the "plus" test gets `tier: "plus"` from the *existing* `WVO_DEFAULT_TIER` force (so it may pass by coincidence), but the "base" test and the "no unlock file forces plus" test fail because `getLicense()` doesn't yet read `trial-unlock.json` at all, so a `base`-tier unlock file has no effect and tier stays whatever `WVO_DEFAULT_TIER` dictates. Confirm at least the "base override" test fails with `expected 'plus' to be 'base'` (or similar) before proceeding.

- [ ] **Step 3: Implement the trial-unlock precedence in `getLicense()`**

In `src/lib/license.ts`, add a helper function directly above `getLicense()`:

```typescript
/**
 * Reads and cryptographically verifies trial-unlock.json (machine-bound HMAC,
 * same check the /api/license unlock-trial route performs). Returns null for
 * anything unreadable, absent, or failing verification — callers fall back to
 * the existing tier logic in that case.
 */
function getVerifiedTrialUnlock(): TrialUnlockPayload | null {
  try {
    const unlockPath = path.join(getAppDataWvoDir(), "trial-unlock.json");
    if (!fs.existsSync(unlockPath)) return null;
    const data = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
    if (!verifyTrialUnlock(data, machineIdSync())) return null;
    return data as TrialUnlockPayload;
  } catch {
    return null;
  }
}
```

Then, inside `getLicense()`, replace the tier-decision block:

```typescript
  // 5. Determine the target license state based on cryptographic validation
  let targetTier: LicenseTier = "base";
  let targetKey: string | null = null;
  let targetNotes: string | null = null;
  let targetExpires: Date | null = null;
  let targetActivated: Date | null = null;

  if (defaultTier === "plus") {
    targetTier = "plus";
    targetKey = "PRE-ACTIVATED-PLUS-BUILD";
    targetNotes = "Activated via Plus Installer Build";
    targetExpires = null;
    targetActivated = row.activatedAt || new Date();
  } else if (baseLicense && plusLicense && !isLicenseExpired(plusLicense.expiresAt)) {
    targetTier = "plus";
    targetKey = plusLicense.licenseKey;
    targetNotes = plusLicense.notes;
    targetExpires = plusLicense.expiresAt ? new Date(plusLicense.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  }
```

with:

```typescript
  // 5. Determine the target license state based on cryptographic validation
  let targetTier: LicenseTier = "base";
  let targetKey: string | null = null;
  let targetNotes: string | null = null;
  let targetExpires: Date | null = null;
  let targetActivated: Date | null = null;

  // A validated trial-unlock.json (day-30 conversion) outranks the trial's
  // pre-activated-Plus default: the unlocked tier — base or plus — is what
  // actually runs, not whatever the build was stamped with.
  const trialUnlock = process.env.WVO_IS_TRIAL === "true" ? getVerifiedTrialUnlock() : null;

  if (trialUnlock) {
    targetTier = trialUnlock.tier;
    targetKey = null;
    targetNotes = trialUnlock.notes;
    targetExpires = trialUnlock.expiresAt ? new Date(trialUnlock.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  } else if (defaultTier === "plus") {
    targetTier = "plus";
    targetKey = "PRE-ACTIVATED-PLUS-BUILD";
    targetNotes = "Activated via Plus Installer Build";
    targetExpires = null;
    targetActivated = row.activatedAt || new Date();
  } else if (baseLicense && plusLicense && !isLicenseExpired(plusLicense.expiresAt)) {
    targetTier = "plus";
    targetKey = plusLicense.licenseKey;
    targetNotes = plusLicense.notes;
    targetExpires = plusLicense.expiresAt ? new Date(plusLicense.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  }
```

The existing anti-tamper logic immediately below this block (the `databaseSaysPlus`/`verifiedPlus` comparison) needs no changes: it already reverts the DB to base whenever `targetTier !== "plus"`, and auto-syncs the DB to `targetTier`/`targetKey`/`targetNotes`/`targetExpires` whenever they disagree — which now correctly handles a base-tier trial unlock (reverts to base) and a plus-tier trial unlock (syncs to plus) without any further edits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/license.test.ts`
Expected: PASS — all tests in the file, including the 4 new ones.

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test`
Expected: PASS, all suites.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/license.ts src/lib/license.test.ts
git commit -m "feat(license): a validated trial-unlock.json determines the post-conversion tier"
```

---

### Task 5: Skip the native base-activation window on trial builds

**Files:**
- Modify: `electron/main.js`

**Interfaces:**
- Consumes: nothing from prior tasks (Electron main process is a separate runtime from the Next.js app; it reads the bundled `.env.local` file directly, the same file `scripts/electron-build.js` already writes `WVO_IS_TRIAL="true"` into for trial builds).
- Produces: no exports — this is an internal behavior change in the app's startup sequence.

- [ ] **Step 1: Add the `isTrialBuild()` detector**

In `electron/main.js`, directly above the `function showActivationWindow() {` definition (originally line 187), insert:

```javascript
// True when this packaged build was produced by `npm run electron:build:trial`.
// scripts/electron-build.js writes WVO_IS_TRIAL="true" into
// resources/nextjs/.env.local for trial builds. Read that file directly here:
// this check runs before startServer() requires the standalone Next.js
// server (which is what normally loads .env.local), and dev builds never
// reach this function's caller because isDev already short-circuits.
function isTrialBuild() {
  try {
    const envPath = path.join(process.resourcesPath, 'nextjs', '.env.local');
    if (!fs.existsSync(envPath)) return false;
    return /^\s*WVO_IS_TRIAL\s*=\s*"?true"?\s*$/m.test(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return false;
  }
}

```

- [ ] **Step 2: Skip the activation check for trial builds**

In `electron/main.js`, inside `app.whenReady().then(async () => { ... })` (originally lines 260-279), replace:

```javascript
    const isActivated = await verifyLicenseSilent();
    if (!isActivated) {
      if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
      await showActivationWindow();
      createLoadingWindow();
    }
```

with:

```javascript
    const isActivated = isTrialBuild() ? true : await verifyLicenseSilent();
    if (!isActivated) {
      if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
      await showActivationWindow();
      createLoadingWindow();
    }
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check electron/main.js`
Expected: no output (exit code 0) — confirms the file still parses as valid JavaScript.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat(electron): skip base-activation window on trial builds"
```

(Full end-to-end verification — building the trial installer and confirming a real launch skips the prompt — happens in Task 7, after docs are updated, so there's exactly one build-and-launch cycle instead of two.)

---

### Task 6: Update the manuals

**Files:**
- Modify: `CLAUDE.md` (Trial/Demo installer section)
- Modify: `MANUAL_Setup_Installation.md` (§6.4)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `CLAUDE.md`**

In the `### Trial/Demo installer (separate mechanism from the License/Plus tier above)` section, after the existing bullet that ends `...src/lib/trial.ts activates the 30-day lock.` (the bullet describing `src/lib/trial.ts`), add two new bullets:

```markdown
- Trial builds skip the native Electron base-activation window entirely (`electron/main.js`'s `isTrialBuild()` reads `WVO_IS_TRIAL="true"` from the bundled `.env.local` and bypasses `verifyLicenseSilent()`/`showActivationWindow()`) — a fresh trial install boots straight to password login, no `WVO-XXXX-XXXX-XXXX-XXXX` key or Firestore lookup required. Base/Plus customer builds are unaffected; they still require the native activation key.
- After a day-30 unlock, the key's own tier — base or plus — determines which features run, not the trial's pre-activated-Plus default: `getLicense()` treats a signature- and machine-verified `trial-unlock.json` as the highest-precedence tier source (see `src/lib/license.ts`'s `getVerifiedTrialUnlock()`). A base-tier unlock key correctly drops Plus features; a plus-tier key keeps them.
```

- [ ] **Step 2: Update `MANUAL_Setup_Installation.md` §6.4**

Read the current §6.4 section first to match its existing tone/structure:

Run: `grep -n "^#### 6.4\|^### 6.4\|^## 6.4" MANUAL_Setup_Installation.md`

Then, in that section, add (adjust heading level to match what the grep reveals — likely `####`) a short subsection near the top of §6.4, before the existing conversion-key generation instructions:

```markdown
**First launch:** a trial install has no activation-key prompt at all — it boots directly to the WhiteVanOps login screen and runs on Plus for 30 days from that first launch. (This differs from a standard Base/Plus customer build, which always requires a `WVO-XXXX-XXXX-XXXX-XXXX` activation key before it will boot.)

**At day 30:** the app locks and, after logging in with a password, shows an in-app activation-key screen. A key generated for either `--tier base` or `--tier plus` (see below) unlocks the app running at that tier — a base key drops Plus features, a plus key keeps them.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md MANUAL_Setup_Installation.md
git commit -m "docs: document trial build's skipped activation window and post-unlock tier behavior"
```

---

### Task 7: Full verification build

**Files:** none modified — this task only runs commands and inspects output.

**Interfaces:** none.

- [ ] **Step 1: Run the full automated gate**

Run: `npm test`
Expected: all suites PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 2: Build the trial installer**

Run: `npm run electron:build:trial`
Expected: build completes; console output includes `Copied .env.local into standalone bundle with WVO_DEFAULT_TIER="plus" and WVO_IS_TRIAL="true".` and the final installer is named `WhiteVanOps-Trial-Setup.exe` under `dist-electron/`.

- [ ] **Step 3: Manually verify the packaged app skips activation**

Install (or run the unpacked build at `dist-electron/win-unpacked/WhiteVanOps.exe`) on a machine/profile with no existing `%APPDATA%\whitevanops\license.json`. Confirm:
- No "Activate WhiteVanOps" / `WVO-XXXX-XXXX-XXXX-XXXX` window appears.
- The app boots straight to the WhiteVanOps password login screen.
- After logging in, the dashboard shows Plus features (Analytics, Invoicing tabs) available.

If `%APPDATA%\whitevanops\license.json` already exists on the test machine from earlier manual testing in this session, delete it first so the check is meaningful:

Run: `Remove-Item "$env:APPDATA\whitevanops\license.json" -ErrorAction SilentlyContinue` (PowerShell) or `rm -f "$APPDATA/whitevanops/license.json"` (bash)

- [ ] **Step 4: No commit for this task**

This task produces no source changes (only gitignored build output under `dist-electron/`) — nothing to stage or commit.

---

## Self-Review Notes

- **Spec coverage:** Task 1–3 cover the `licenseCrypto.ts` extraction (spec §3). Task 4 covers the `getLicense()` precedence (spec §2), including all 5 listed test cases (trial-unlock plus, trial-unlock base, no unlock file, invalid/wrong-machine unlock file, and non-trial-unchanged — the last one is the entire *rest* of the untouched `license.test.ts` suite, which Task 4's Step 4 re-runs in full). Task 5 covers `main.js` (spec §1). Task 6 covers the two doc files. Task 7 covers the full build-and-launch check (spec's Testing section).
- **Type consistency:** `TrialUnlockPayload` has one definition (in `licenseCrypto.ts`, Task 1) re-exported by both `trial.ts` (Task 3, `export type { TrialUnlockPayload }`) and imported directly by `license.ts` (Task 2/4) — no duplicate or divergent shape.
- **No placeholders:** every step shows complete, runnable code or exact commands with expected output.
