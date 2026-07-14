# Trial/Demo Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth Electron installer variant (`WhiteVanOps-Trial-Setup.exe`) that runs on Plus tier for 30 days from first launch, then fully locks the app until a purchase activation key (Base or Plus, depending on what was bought) is entered.

**Architecture:** A signed, machine-bound anchor file (`trial.json`) tracks install date; a new `src/lib/trial.ts` module (mirroring the self-healing style of the existing `src/lib/license.ts`) computes lock state from it. Lock state is stamped into the session JWT at login (same mechanism as the existing `mustChangePassword` forced-flow) so the edge-runtime middleware never needs filesystem/DB access. A single signed JSON activation key, verified against the real machine ID, permanently clears the lock and sets the final tier.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/PostgreSQL, `node-machine-id`, `jose` (JWT), Vitest, Electron/electron-builder.

## Global Constraints

- Reuse the existing `LICENSE_SIGNING_SECRET` HMAC-SHA256 pattern from `src/lib/license.ts` — do not introduce a second secret.
- Non-trial builds (`WVO_IS_TRIAL` unset) must see zero behavior change — `getTrialStatus()` short-circuits with no file I/O when the env var isn't `"true"`.
- Follow this repo's test conventions exactly: `vi.stubEnv`/`vi.unstubAllEnvs` for env vars (never direct `process.env.X =` assignment), `vi.spyOn(fs, "...")` on the real `fs` module (not `vi.mock("fs")`) per the existing pattern in `src/lib/license.test.ts`, `vi.resetAllMocks()` in `beforeEach` (not `vi.clearAllMocks()`).
- Every write API route must call `requireRole` before any DB/file mutation, per `src/lib/auth.ts` convention.
- Update `MANUAL_Setup_Installation.md` as part of this work, per this project's CLAUDE.md manual-update policy — not an optional follow-up.

---

### Task 1: `src/lib/trial.ts` — trial status core logic

**Files:**
- Create: `src/lib/trial.ts`
- Test: `src/lib/trial.test.ts`

**Interfaces:**
- Consumes: `getAppDataWvoDir()`, `LICENSE_SIGNING_SECRET` from `src/lib/license.ts` (both already exported); `machineIdSync` from `node-machine-id`.
- Produces (for later tasks):
  - `export interface TrialStatus { isTrial: boolean; daysRemaining: number; isLocked: boolean; machineId: string | null; }`
  - `export interface TrialUnlockPayload { machineId: string; tier: "base" | "plus"; expiresAt: string | null; notes: string | null; sig: string; }`
  - `export function getTrialStatus(now?: Date): TrialStatus`
  - `export function verifyTrialUnlock(payload: unknown, machineId: string): payload is TrialUnlockPayload`
  - `export function signTrialUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string`
  - `export function markTrialUnlocked(payload: TrialUnlockPayload): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/trial.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

vi.mock("node-machine-id", () => ({
  machineIdSync: vi.fn(() => "test-machine-id"),
}));

import {
  getTrialStatus,
  verifyTrialUnlock,
  signTrialUnlock,
  markTrialUnlocked,
} from "./trial";
import { LICENSE_SIGNING_SECRET } from "./license";

const NOW = new Date("2026-07-13T12:00:00Z");

describe("getTrialStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
    vi.unstubAllEnvs();
  });

  it("is a no-op for non-trial builds", () => {
    vi.stubEnv("WVO_IS_TRIAL", "");
    vi.spyOn(fs, "existsSync").mockReturnValue(true); // would blow up if read
    const status = getTrialStatus(NOW);
    expect(status).toEqual({ isTrial: false, daysRemaining: 0, isLocked: false, machineId: null });
  });

  it("creates a signed anchor file on first read", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);

    const status = getTrialStatus(NOW);

    expect(writeSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeSpy.mock.calls[0];
    expect(String(writtenPath)).toMatch(/trial\.json$/);
    const anchor = JSON.parse(writtenContent as string);
    expect(anchor.installedAt).toBe(NOW.toISOString());
    expect(anchor.machineId).toBe("test-machine-id");
    expect(status.isTrial).toBe(true);
    expect(status.isLocked).toBe(false);
    expect(status.daysRemaining).toBe(30);
  });

  it("is not locked within the 30-day window", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-07-01T12:00:00Z").toISOString();
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${installedAt}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig })
    );

    const status = getTrialStatus(NOW); // 12 days after install
    expect(status.isLocked).toBe(false);
    expect(status.daysRemaining).toBe(18);
  });

  it("is locked once 30 days have elapsed with no unlock file", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-05-01T12:00:00Z").toISOString();
    const sig = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${installedAt}:test-machine-id`)
      .digest("hex");

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig })
    );

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(true);
    expect(status.daysRemaining).toBe(0);
  });

  it("is never locked once a valid trial-unlock.json exists, regardless of elapsed time", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => String(p).endsWith("trial-unlock.json"));

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(false);
  });

  it("fails closed (locked) if the anchor file signature has been tampered with", () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    const installedAt = new Date("2026-07-01T12:00:00Z").toISOString();

    vi.spyOn(fs, "existsSync").mockImplementation((p: any) => String(p).endsWith("trial.json"));
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({ installedAt, machineId: "test-machine-id", sig: "tampered" })
    );

    const status = getTrialStatus(NOW);
    expect(status.isLocked).toBe(true);
  });
});

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

describe("markTrialUnlocked", () => {
  it("writes trial-unlock.json with the given payload", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    const payload = { machineId: "test-machine-id", tier: "base" as const, expiresAt: null, notes: "test", sig: "x" };

    markTrialUnlocked(payload);

    expect(writeSpy).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = writeSpy.mock.calls[0];
    expect(String(writtenPath)).toMatch(/trial-unlock\.json$/);
    expect(JSON.parse(writtenContent as string)).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/trial.test.ts`
Expected: FAIL — `Cannot find module './trial'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/trial.ts`:

```typescript
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import { getAppDataWvoDir, LICENSE_SIGNING_SECRET } from "./license";

// ---------------------------------------------------------------------------
// Trial-lock for demo installers (WVO_IS_TRIAL=true builds only). Independent
// of the Base/Plus tier gate in license.ts: a trial install runs on Plus for
// 30 days from first launch, then locks the whole app regardless of tier,
// until a signed unlock key (see verifyTrialUnlock) is applied.
// ---------------------------------------------------------------------------

const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialAnchor {
  installedAt: string;
  machineId: string;
  sig: string;
}

export interface TrialUnlockPayload {
  machineId: string;
  tier: "base" | "plus";
  expiresAt: string | null;
  notes: string | null;
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

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/trial.test.ts`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trial.ts src/lib/trial.test.ts
git commit -m "feat: add trial-lock status module for demo installers"
```

---

### Task 2: Stamp `trialLocked` into the session JWT at login

**Files:**
- Modify: `src/lib/auth.ts:7-14` (SessionUser interface)
- Modify: `src/app/api/auth/login/route.ts:82-89` (token signing call)
- Test: `src/lib/auth.test.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `getTrialStatus()` from `src/lib/trial.ts` (Task 1).
- Produces: `SessionUser.trialLocked?: boolean` — consumed by Task 3 (middleware).

- [ ] **Step 1: Read the existing auth test file to match conventions**

Read `src/lib/auth.test.ts` to confirm the existing mocking style for `next/headers` before adding cases — match it exactly.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/auth.test.ts` (append a new `describe` block; keep existing imports/mocks as-is):

```typescript
describe("SessionUser trialLocked claim round-trips through signSessionToken", () => {
  it("preserves trialLocked: true through sign and verify", async () => {
    process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long";
    const token = await signSessionToken({
      userId: "u1",
      username: "admin",
      displayName: "Admin",
      role: "superuser",
      trialLocked: true,
    });
    expect(typeof token).toBe("string");
    const [, payloadB64] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    expect(decoded.trialLocked).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL with a TypeScript error — `trialLocked` does not exist on type `SessionUser`.

- [ ] **Step 4: Add `trialLocked` to `SessionUser`**

Edit `src/lib/auth.ts` lines 7-14 from:

```typescript
export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  personnelId?: string;
  mustChangePassword?: boolean;
}
```

to:

```typescript
export interface SessionUser {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  personnelId?: string;
  mustChangePassword?: boolean;
  /** Stamped at login for WVO_IS_TRIAL builds whose 30-day trial has expired with no unlock key applied. */
  trialLocked?: boolean;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire `trialLocked` into the login route**

Edit `src/app/api/auth/login/route.ts`. Add the import (after the existing `checkRateLimit` import on line 5):

```typescript
import { checkRateLimit } from "@/lib/rateLimit";
import { getTrialStatus } from "@/lib/trial";
```

Replace lines 82-89:

```typescript
  const token = await signSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as Role,
    personnelId: user.personnelId ?? undefined,
    mustChangePassword: user.mustChangePassword,
  });
```

with:

```typescript
  const trialStatus = getTrialStatus();

  const token = await signSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as Role,
    personnelId: user.personnelId ?? undefined,
    mustChangePassword: user.mustChangePassword,
    trialLocked: trialStatus.isLocked,
  });
```

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all existing suites plus the new trial/auth cases green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts src/app/api/auth/login/route.ts
git commit -m "feat: stamp trialLocked claim into session JWT at login"
```

---

### Task 3: Middleware redirect to `/trial-expired`

**Files:**
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `payload.trialLocked` (boolean) from the JWT, set in Task 2. No new imports — middleware stays edge-safe (no `fs`/Prisma), per the existing file's own design comment.
- Produces: nothing new consumed by later tasks (the `/trial-expired` route itself is Task 4).

- [ ] **Step 1: Edit `src/middleware.ts`**

Add a new constant after line 14 (`CHANGE_PASSWORD_PATHS`):

```typescript
const CHANGE_PASSWORD_PATHS = ["/change-password", "/api/auth/change-password"];
const TRIAL_EXPIRED_PATHS = ["/trial-expired", "/api/trial-unlock"];
```

Add a new branch immediately after the existing `mustChangePassword` block (after line 43, the `}` closing that `if`):

```typescript
    // Force password change before anything else
    if (mustChangePassword && !CHANGE_PASSWORD_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/change-password", req.url));
    }

    // Trial-lock takes priority over role-based routing — a locked trial
    // install shows nothing but the unlock screen until a valid key is applied.
    const trialLocked = payload.trialLocked as boolean | undefined;
    if (trialLocked && !TRIAL_EXPIRED_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/trial-expired", req.url));
    }
```

(The rest of the file — tech role restriction, superuser-only paths, catch block, `config.matcher` — is unchanged.)

- [ ] **Step 2: Manually verify the edit compiles**

Run: `npx tsc --noEmit`
Expected: No new errors from `src/middleware.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: redirect trial-locked sessions to /trial-expired"
```

---

### Task 4: `POST /api/license` `unlock-trial` action + `GET` trial field

**Files:**
- Modify: `src/app/api/license/route.ts`
- Test: `src/app/api/license/route.test.ts` (new — check with `Glob src/app/api/license/*.test.ts` first in case one was added since this plan was written)

**Interfaces:**
- Consumes: `getTrialStatus()`, `verifyTrialUnlock()`, `markTrialUnlocked()`, `TrialUnlockPayload` from `src/lib/trial.ts` (Task 1); `machineIdSync` from `node-machine-id`.
- Produces: `GET /api/license` response gains `trial: { isTrial, daysRemaining, isLocked, machineId }`. `POST /api/license` accepts `{ action: "unlock-trial", licenseKey: string }` in addition to the existing `{ tier: "base" | "plus", ... }` body shape — consumed by Task 5 (trial-expired page) and Task 6 (Settings UI).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/license/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";

vi.mock("@/lib/db", () => ({
  prisma: {
    license: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("node-machine-id", () => ({
  machineIdSync: vi.fn(() => "test-machine-id"),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({
      payload: { userId: "u1", username: "admin", displayName: "Admin", role: "superuser" },
    })),
  };
});

import { prisma } from "@/lib/db";
import { LICENSE_SIGNING_SECRET } from "@/lib/license";
import { POST } from "./route";

function signUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${machineId}:${tier}:${expiresAt || ""}`)
    .digest("hex");
}

describe("POST /api/license — unlock-trial action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(machineIdSync).mockReturnValue("test-machine-id");
  });

  it("accepts a validly signed base-tier unlock key and downgrades to base", async () => {
    const sig = signUnlock("test-machine-id", "base", null);
    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: "singleton",
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({
        action: "unlock-trial",
        licenseKey: JSON.stringify({ machineId: "test-machine-id", tier: "base", expiresAt: null, notes: "Base purchase", sig }),
      }),
    });

    const res = await POST(req as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tier).toBe("base");
    expect(prisma.license.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ tier: "base" }) })
    );
  });

  it("rejects a key signed for a different machine", async () => {
    const sig = signUnlock("someone-elses-machine", "plus", null);
    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({
        action: "unlock-trial",
        licenseKey: JSON.stringify({ machineId: "someone-elses-machine", tier: "plus", expiresAt: null, notes: null, sig }),
      }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
    expect(prisma.license.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON in licenseKey", async () => {
    const req = new Request("http://localhost/api/license", {
      method: "POST",
      body: JSON.stringify({ action: "unlock-trial", licenseKey: "not json" }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/license/route.test.ts`
Expected: FAIL — the `action: "unlock-trial"` branch doesn't exist yet, so behavior/response shape won't match. Confirm red before implementing.

- [ ] **Step 3: Implement the `unlock-trial` action**

Edit `src/app/api/license/route.ts`. Update the import block (lines 5-14) to:

```typescript
import {
  getLicense,
  isPlusActive,
  LICENSE_ROW_ID,
  getBaseLicense,
  verifyPlusLicense,
  getAppDataWvoDir,
} from "@/lib/license";
import { getTrialStatus, verifyTrialUnlock, markTrialUnlocked, TrialUnlockPayload } from "@/lib/trial";
import { machineIdSync } from "node-machine-id";
import fs from "fs";
import path from "path";
```

Modify the `GET` handler (lines 16-33) to include trial status:

```typescript
export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const license = await getLicense();
    const baseLicense = getBaseLicense();
    const trial = getTrialStatus();
    return NextResponse.json({
      ...license,
      plus: isPlusActive(license),
      activeBaseKey: baseLicense ? baseLicense.key : null,
      trial,
    });
  } catch (error) {
    console.error("License GET API Error:", error);
    return NextResponse.json({ error: "Failed to read license" }, { status: 500 });
  }
}
```

Modify the `POST` handler: insert a new branch at the very top of the `try` block (line 41), before the existing `const { tier } = body;` line:

```typescript
export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "superuser");
  if (err) return err;

  try {
    const body = await request.json();

    if (body.action === "unlock-trial") {
      let payload: unknown;
      try {
        payload = typeof body.licenseKey === "string" ? JSON.parse(body.licenseKey.trim()) : body.licenseKey;
      } catch {
        return NextResponse.json(
          { error: "Invalid activation key format. Must be a valid JSON block." },
          { status: 400 }
        );
      }

      const machineId = machineIdSync();
      if (!verifyTrialUnlock(payload, machineId)) {
        return NextResponse.json(
          { error: "Invalid activation key — it doesn't match this machine or the signature is invalid." },
          { status: 400 }
        );
      }

      const unlockPayload = payload as TrialUnlockPayload;
      markTrialUnlocked(unlockPayload);

      const expiresAt = unlockPayload.expiresAt ? new Date(unlockPayload.expiresAt) : null;
      const data = {
        tier: unlockPayload.tier,
        licenseKey: null,
        notes: unlockPayload.notes,
        expiresAt,
        activatedAt: new Date(),
      };
      const row = await prisma.license.upsert({
        where: { id: LICENSE_ROW_ID },
        update: data,
        create: { id: LICENSE_ROW_ID, ...data },
      });

      await audit(user!.userId, "UPDATE", "License", row.id, { action: "unlock-trial", tier: unlockPayload.tier });

      return NextResponse.json({
        tier: row.tier,
        licenseKey: row.licenseKey,
        notes: row.notes,
        activatedAt: row.activatedAt,
        expiresAt: row.expiresAt,
        plus: unlockPayload.tier === "plus",
        trial: getTrialStatus(),
      });
    }

    const { tier } = body;
    // ... existing tier === "base" | "plus" logic below is unchanged ...
```

Leave everything from the existing `if (tier !== "base" && tier !== "plus")` line through the end of the function exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/license/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions in `license.test.ts` or elsewhere.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/license/route.ts src/app/api/license/route.test.ts
git commit -m "feat: add unlock-trial action to license API"
```

---

### Task 5: `/trial-expired` page

**Files:**
- Create: `src/app/trial-expired/page.tsx`
- Create: `src/app/trial-expired/TrialExpiredClient.tsx`
- Create: `src/components/trial/TrialUnlockForm.tsx` (client component, shared by this page and Task 6's Settings banner)

**Interfaces:**
- Consumes: `getSessionUser()` from `@/lib/auth`, `getTrialStatus()` from `@/lib/trial` (server-side, for displaying machine ID); `POST /api/license` with `{ action: "unlock-trial", licenseKey }` (Task 4).
- Produces: `TrialUnlockForm` component — `export function TrialUnlockForm({ machineId, onUnlocked }: { machineId: string | null; onUnlocked: () => void })` — consumed by Task 6.

- [ ] **Step 1: Create the shared unlock form component**

Create `src/components/trial/TrialUnlockForm.tsx`:

```tsx
"use client";

import { useState } from "react";

type Props = {
  machineId: string | null;
  onUnlocked: () => void;
};

export function TrialUnlockForm({ machineId, onUnlocked }: Props) {
  const [pastedKey, setPastedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    const trimmed = pastedKey.trim();
    if (!trimmed) {
      setError("Paste the activation key you received from your vendor.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock-trial", licenseKey: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to apply activation key.");
        return;
      }
      onUnlocked();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {machineId && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Machine ID (send this to your vendor)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={machineId}
              className="flex-1 font-mono text-xs bg-zinc-50 border border-zinc-300 rounded p-2 text-zinc-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(machineId)}
              className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded text-xs font-semibold text-zinc-700 transition-colors uppercase tracking-wider"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Paste Activation Key
        </label>
        <textarea
          value={pastedKey}
          onChange={(e) => setPastedKey(e.target.value)}
          placeholder="Paste the cryptographically signed JSON block your vendor sent you..."
          className="w-full h-32 text-xs font-mono border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 p-2 border bg-white placeholder-zinc-400"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Verifying..." : "Apply Activation Key"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the `/trial-expired` page**

Create `src/app/trial-expired/page.tsx`:

```tsx
import { getSessionUser } from "@/lib/auth";
import { getTrialStatus } from "@/lib/trial";
import { TrialExpiredClient } from "./TrialExpiredClient";

export default async function TrialExpiredPage() {
  await getSessionUser(); // middleware already guarantees a valid, trial-locked session exists
  const trial = getTrialStatus();

  return <TrialExpiredClient machineId={trial.machineId} />;
}
```

Create `src/app/trial-expired/TrialExpiredClient.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { TrialUnlockForm } from "@/components/trial/TrialUnlockForm";

export function TrialExpiredClient({ machineId }: { machineId: string | null }) {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="White Van Ops" className="h-14 w-14 rounded" />
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fleet Operations</p>
            <h1 className="text-2xl font-bold text-zinc-900 uppercase tracking-wide">White Van Ops</h1>
          </div>
        </div>

        <div className="flex items-start gap-3 mb-5 bg-amber-50 border border-amber-300 rounded px-4 py-3">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            Your 30-day trial has ended. Enter an activation key to continue using WhiteVanOps.
          </p>
        </div>

        <div className="bg-white border border-zinc-300 rounded p-8">
          <TrialUnlockForm machineId={machineId} onUnlocked={() => router.push("/")} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the page compiles**

Run: `npx tsc --noEmit`
Expected: No errors from the new files.

- [ ] **Step 4: Commit**

```bash
git add src/components/trial/TrialUnlockForm.tsx src/app/trial-expired/page.tsx src/app/trial-expired/TrialExpiredClient.tsx
git commit -m "feat: add trial-expired lockout page with activation key entry"
```

---

### Task 6: Settings → License & Plan trial banner

**Files:**
- Modify: `src/components/tabs/SettingsTab.tsx`

**Interfaces:**
- Consumes: `TrialUnlockForm` from `src/components/trial/TrialUnlockForm.tsx` (Task 5); `trial` field on the `GET /api/license` response (Task 4).

- [ ] **Step 1: Extend the `LicenseResponse` interface**

Edit `src/components/tabs/SettingsTab.tsx` lines 5-13, from:

```typescript
interface LicenseResponse {
  tier: "base" | "plus";
  licenseKey: string | null;
  notes: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activeBaseKey: string | null;
  plus: boolean;
}
```

to:

```typescript
interface LicenseResponse {
  tier: "base" | "plus";
  licenseKey: string | null;
  notes: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activeBaseKey: string | null;
  plus: boolean;
  trial: {
    isTrial: boolean;
    daysRemaining: number;
    isLocked: boolean;
    machineId: string | null;
  };
}
```

- [ ] **Step 2: Add the import**

Add near the top of the file (after the existing `formatDate` import on line 3):

```typescript
import { formatDate } from "@/lib/dateUtils";
import { TrialUnlockForm } from "@/components/trial/TrialUnlockForm";
```

- [ ] **Step 3: Render the trial banner**

Inside the `LicenseSection` component, immediately after the opening `<div className="p-6 space-y-6">` on line 163, add:

```tsx
      <div className="p-6 space-y-6">
        {license.trial.isTrial && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded space-y-3">
            <p className="text-sm font-semibold text-blue-800">
              Trial: {license.trial.daysRemaining} day{license.trial.daysRemaining === 1 ? "" : "s"} remaining
            </p>
            <p className="text-xs text-blue-700">
              Purchased? Enter your activation key below to convert this install permanently.
            </p>
            <TrialUnlockForm machineId={license.trial.machineId} onUnlocked={fetchLicense} />
          </div>
        )}

        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded text-sm text-zinc-600 flex gap-3">
```

(This leaves the existing `<AlertCircle ...>` block, which starts right after, untouched — it just now follows the new conditional banner.)

- [ ] **Step 4: Verify the component compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual UI check** (per this project's CLAUDE.md — UI changes must be exercised in a browser, not just type-checked)

Run: `npm run electron:dev` (or `npm run dev` and open `http://localhost:3000`), log in as superuser, open Settings → License & Plan. With `WVO_IS_TRIAL` unset in your dev `.env.local`, confirm the banner does NOT render and the page looks identical to before this change.

- [ ] **Step 6: Commit**

```bash
git add src/components/tabs/SettingsTab.tsx
git commit -m "feat: show trial status banner and unlock form in Settings"
```

---

### Task 7: `--unlock-trial` flag on `scripts/license-manager.js`

**Files:**
- Modify: `scripts/license-manager.js`

**Interfaces:**
- Consumes: nothing from the app (standalone Node CLI script, run on the vendor's machine, mirrors the existing `--plus` branch's self-contained crypto).
- Produces: a JSON payload matching `TrialUnlockPayload` from Task 1 — printed to console for the vendor to send to the customer.

- [ ] **Step 1: Add the new flag branch**

Edit `scripts/license-manager.js`. Insert a new branch before the existing `if (isPlusMode) {` block (line 7), i.e. right after `const isPlusMode = args.includes("--plus");` on line 5:

```javascript
const args = process.argv.slice(2);
const isPlusMode = args.includes("--plus");
const isUnlockTrialMode = args.includes("--unlock-trial");

if (isUnlockTrialMode) {
  const machineIdx = args.indexOf("--machine");
  const tierIdx = args.indexOf("--tier");
  const expiresIdx = args.indexOf("--expires");
  const notesIdx = args.indexOf("--notes");

  const machineId = machineIdx !== -1 ? args[machineIdx + 1]?.trim() : null;
  const tier = tierIdx !== -1 ? args[tierIdx + 1]?.trim() : null;

  if (!machineId || (tier !== "base" && tier !== "plus")) {
    console.error("Error: --machine <machineId> and --tier base|plus are required in --unlock-trial mode");
    console.error("Usage: node scripts/license-manager.js --unlock-trial --machine <machineId> --tier base|plus [--expires <YYYY-MM-DD>] [--notes <notes>]");
    process.exit(1);
  }

  let expiresAt = null;
  if (expiresIdx !== -1 && expiresIdx + 1 < args.length) {
    const expStr = args[expiresIdx + 1].trim();
    const date = new Date(expStr);
    if (isNaN(date.getTime())) {
      console.error(`Error: Invalid expiry date '${expStr}'. Use YYYY-MM-DD format.`);
      process.exit(1);
    }
    expiresAt = date.toISOString();
  }

  let notes = null;
  if (notesIdx !== -1 && notesIdx + 1 < args.length) {
    notes = args[notesIdx + 1].trim();
  } else {
    notes = `Trial converted on ${new Date().toISOString().split("T")[0]}`;
  }

  const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";
  const signatureData = `${machineId}:${tier}:${expiresAt || ""}`;
  const sig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(signatureData)
    .digest("hex");

  const payload = { machineId, tier, expiresAt, notes, sig };

  console.log(`\n✅ Success! Trial Activation Key Generated (tier: ${tier}):`);
  console.log(`\n${JSON.stringify(payload, null, 2)}\n`);
  console.log("Send the JSON block above to the customer. They paste it into Settings → License & Plan (or the trial-expired screen) to convert their install.");
  process.exit(0);
}

if (isPlusMode) {
```

- [ ] **Step 2: Manually verify the script runs**

Run: `node scripts/license-manager.js --unlock-trial --machine test-machine-id --tier plus --notes "Test purchase"`
Expected output: a JSON block with `"tier": "plus"`, `"machineId": "test-machine-id"`, and a 64-character hex `sig`.

Cross-check the signature matches what the app would compute:
```bash
node -e "const c=require('crypto'); console.log(c.createHmac('sha256','wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765').update('test-machine-id:plus:').digest('hex'))"
```
This should match the `sig` printed by the script above (both use `expiresAt || ""` = `""` when null).

- [ ] **Step 3: Commit**

```bash
git add scripts/license-manager.js
git commit -m "feat: add --unlock-trial flag to license-manager.js for minting trial activation keys"
```

---

### Task 8: `electron:build:trial` installer script

**Files:**
- Modify: `scripts/electron-build.js`
- Modify: `package.json:14-17`

**Interfaces:**
- Consumes: nothing new — follows the exact shape of the existing `--base`/`--plus` branches.
- Produces: `dist-electron/WhiteVanOps-Trial-Setup.exe`, bundled `.env.local` with `WVO_IS_TRIAL="true"` and `WVO_DEFAULT_TIER="plus"`.

- [ ] **Step 1: Add the `--trial` flag**

Edit `scripts/electron-build.js` lines 9-16, from:

```javascript
const args = process.argv.slice(2);
const isBase = args.includes('--base');
const isPlus = args.includes('--plus');
const isUpgrade = args.includes('--upgrade');

let tier = 'base';
if (isPlus) tier = 'plus';
if (isUpgrade) tier = 'upgrade';
```

to:

```javascript
const args = process.argv.slice(2);
const isBase = args.includes('--base');
const isPlus = args.includes('--plus');
const isUpgrade = args.includes('--upgrade');
const isTrial = args.includes('--trial');

let tier = 'base';
if (isPlus) tier = 'plus';
if (isUpgrade) tier = 'upgrade';
if (isTrial) tier = 'trial';
```

- [ ] **Step 2: Set the bundled env vars for trial builds**

Edit lines 184-187, from:

```javascript
// Append WVO_DEFAULT_TIER to build
envContent += `\nWVO_DEFAULT_TIER="${tier}"\n`;
fs.writeFileSync(envDest, envContent, 'utf8');
console.log(`\nCopied .env.local into standalone bundle with WVO_DEFAULT_TIER="${tier}".`);
```

to:

```javascript
// Append WVO_DEFAULT_TIER to build. Trial builds default to Plus (so the
// prospect experiences the full feature set) and set WVO_IS_TRIAL so
// src/lib/trial.ts activates the 30-day lock.
const effectiveTier = tier === 'trial' ? 'plus' : tier;
envContent += `\nWVO_DEFAULT_TIER="${effectiveTier}"\n`;
if (tier === 'trial') {
  envContent += `WVO_IS_TRIAL="true"\n`;
}
fs.writeFileSync(envDest, envContent, 'utf8');
console.log(`\nCopied .env.local into standalone bundle with WVO_DEFAULT_TIER="${effectiveTier}"${tier === 'trial' ? ' and WVO_IS_TRIAL="true"' : ''}.`);
```

- [ ] **Step 3: Rename the trial installer output**

Edit lines 229-243, from:

```javascript
// 8. Rename resulting installer file for clarity
try {
  const files = fs.readdirSync(distElectron);
  const setupFile = files.find(f => f.startsWith('WhiteVanOps Setup') && f.endsWith('.exe'));
  if (setupFile) {
    const newName = tier === 'plus' ? 'WhiteVanOps-Plus-Setup.exe' : 'WhiteVanOps-Base-Setup.exe';
    fs.renameSync(
      path.join(distElectron, setupFile),
      path.join(distElectron, newName)
    );
    console.log(`\n✅ Success! Renamed installer: ${setupFile} → ${newName}`);
  }
} catch (err) {
  console.warn('\nNote: Could not automatically rename the installer file:', err.message);
}
```

to:

```javascript
// 8. Rename resulting installer file for clarity
try {
  const files = fs.readdirSync(distElectron);
  const setupFile = files.find(f => f.startsWith('WhiteVanOps Setup') && f.endsWith('.exe'));
  if (setupFile) {
    let newName = 'WhiteVanOps-Base-Setup.exe';
    if (tier === 'plus') newName = 'WhiteVanOps-Plus-Setup.exe';
    if (tier === 'trial') newName = 'WhiteVanOps-Trial-Setup.exe';
    fs.renameSync(
      path.join(distElectron, setupFile),
      path.join(distElectron, newName)
    );
    console.log(`\n✅ Success! Renamed installer: ${setupFile} → ${newName}`);
  }
} catch (err) {
  console.warn('\nNote: Could not automatically rename the installer file:', err.message);
}
```

- [ ] **Step 4: Add the npm script**

Edit `package.json` lines 14-17, from:

```json
    "electron:dev": "node scripts/electron-dev.js",
    "electron:build": "node scripts/electron-build.js --base",
    "electron:build:base": "node scripts/electron-build.js --base",
    "electron:build:plus": "node scripts/electron-build.js --plus",
    "electron:build:upgrade": "node scripts/electron-build.js --upgrade",
```

to:

```json
    "electron:dev": "node scripts/electron-dev.js",
    "electron:build": "node scripts/electron-build.js --base",
    "electron:build:base": "node scripts/electron-build.js --base",
    "electron:build:plus": "node scripts/electron-build.js --plus",
    "electron:build:trial": "node scripts/electron-build.js --trial",
    "electron:build:upgrade": "node scripts/electron-build.js --upgrade",
```

- [ ] **Step 5: Verify the script's control flow with a dry check**

Run: `node -e "const args=['--trial']; const isTrial=args.includes('--trial'); let tier='base'; if(isTrial) tier='trial'; console.log(tier)"`
Expected output: `trial`

(A full `npm run electron:build:trial` is expensive — pgsql binaries, full Next.js build, NSIS packaging — and is exercised manually per Task 9's checklist, not run automatically here.)

- [ ] **Step 6: Commit**

```bash
git add scripts/electron-build.js package.json
git commit -m "feat: add electron:build:trial installer target"
```

---

### Task 9: Manual documentation update

**Files:**
- Modify: `MANUAL_Setup_Installation.md`

- [ ] **Step 1: Add the trial installer section**

In `MANUAL_Setup_Installation.md`, insert a new subsection after the existing "3. Plus Upgrade Installer (Patch Utility)" block (after its `* **Note:** ...` line and before the `---` that precedes "### What the build commands do"):

```markdown
### 4. Trial/Demo Installer (Sales Demos)
Builds a time-limited demo installer for prospect evaluations. Runs on **Plus** tier so the prospect can try every feature, then fully locks the app 30 days after first launch until an activation key is entered.
```bash
npm run electron:build:trial
```
* **Output:** `dist-electron/WhiteVanOps-Trial-Setup.exe`
* **Converting a trial to a paid install:** Have the customer open **Settings → License & Plan** (or, once locked, the lockout screen itself) and copy their Machine ID. Generate their activation key on your machine:
  ```bash
  node scripts/license-manager.js --unlock-trial --machine <theirMachineId> --tier base|plus [--notes "Order #1234"]
  ```
  Use `--tier base` if they purchased Base only (this also correctly drops the Plus features they were trialing), or `--tier plus` if they purchased Base+Plus. Send the printed JSON block back to them to paste into the same screen. This is a one-time, permanent conversion — there's no way to re-trial a machine after this without deleting `%APPDATA%\whitevanops\` entirely, which is a customer-initiated action outside the app's control.
```

- [ ] **Step 2: Cross-check the section renders correctly**

Read the file back and confirm the new section sits between the existing "3. Plus Upgrade Installer" and "### What the build commands do" headers, with heading levels consistent with the surrounding "### 1." / "### 2." / "### 3." pattern (renumber to "### 4." if it reads naturally as a sibling of 1-3, which it does since it's a fourth installer variant).

- [ ] **Step 3: Commit**

```bash
git add MANUAL_Setup_Installation.md
git commit -m "docs: document trial installer build and conversion flow"
```

---

## Final Verification

- [ ] Run the full test suite once more: `npm test` — expect all green.
- [ ] Run `npx tsc --noEmit` — expect no errors.
- [ ] Run `npm run lint` — expect no new warnings/errors in touched files.
- [ ] Manually smoke-test the trial-lock flow end-to-end in dev (per `superpowers:verification-before-completion` — don't claim success without running this):
  1. In a scratch `.env.local`, set `WVO_IS_TRIAL=true`.
  2. Start the app, log in, confirm Settings → License & Plan shows "Trial: 30 days remaining" and the app runs on Plus.
  3. To simulate expiry without waiting 30 days: temporarily lower `TRIAL_LENGTH_MS` in a local scratch copy of `src/lib/trial.ts` for this manual test only (revert before committing — do not ship a shrink-trial-length env var).
  4. Confirm logging in now redirects to `/trial-expired`, and the machine ID displays.
  5. Generate a key via `node scripts/license-manager.js --unlock-trial --machine <shownId> --tier plus`, paste it in, confirm it unlocks and the app loads normally.
  6. Restart the app entirely and confirm it stays unlocked (trial-unlock.json persists).
