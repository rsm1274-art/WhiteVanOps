# WiFi Sync on Base, Tunnel on Plus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Base plan sync field work over the office LAN only, reserve the Cloudflare tunnel for Plus, ship four installers (Base, Plus, Base trial, Plus trial), delete the in-place upgrade path, and update the website and manuals to match.

**Architecture:** Entitlement stays where it already is — `hasPlusLicense()`, backed by the signed machine-bound activation key. The Base/Plus installers differ in *payload*: Plus bundles `cloudflared`, Base does not, so a Base install cannot tunnel for two independent reasons (no entitlement, no binary). A Base trial needs a pre-activated *Base* plan, which requires a plan stamp in the bundled `.env.local`; that stamp is HMAC-signed and fails closed to `base`, so it can never become the next `WVO_DEFAULT_TIER`. The field module's offline queue already exists and is unchanged — only its *status reporting* is rewritten, because today it claims "Syncing…" indefinitely while nothing syncs.

**Tech Stack:** Next.js 16 App Router · TypeScript · Vitest (`environment: "node"`) · Electron 42 + electron-builder (NSIS, Windows only) · Prisma + `@prisma/adapter-pg` · Node `crypto` HMAC-SHA256 · IndexedDB / `localStorage` on the field surface

**Spec:** `docs/superpowers/specs/2026-07-24-wifi-sync-base-tier-design.md`

## Global Constraints

- **Never introduce a tier/plan value that grants Plus from unsigned configuration.** `WVO_DEFAULT_TIER` was removed on 2026-07-15 for exactly this. Any new plan input must be signature-verified and must fail closed to `"base"`.
- **`hasPlusLicense()` remains the only entitlement source.** No new DB column, no new field in the activation key, no runtime env var that unlocks features.
- **Do not reintroduce a global HTTPS flag.** Session cookie `secure` is derived per-request in `src/lib/auth.ts`. One server answers both `http://localhost:3000` (Electron) and the Plus HTTPS host.
- **Windows is the only build target.** Do not add `--linux` or a `build.linux` key.
- **`npm run build` must stay `--webpack`**, never Turbopack. Prisma externals break otherwise.
- **Tests:** `environment: "node"`, `include: ["src/**/*.test.ts"]`. Mock `@/lib/db` in anything importing it. Use `vi.resetAllMocks()` in `beforeEach`, `vi.stubEnv` over direct `process.env` assignment. Keep fake secret-shaped fixtures under ~20 chars so `scripts/scan-secrets.js` does not trip.
- **Do not change which feature modules each plan includes.** The eight Base modules and three Plus modules (CRM notes/follow-ups, Analytics, Invoicing) are untouched everywhere, including the website's "Eight modules on Base. Three more on Plus." headline and every `fcard`.
- **Exact prices:** Base `$500 one-time`. Plus `$1,000 one-time`. No "Upgrade" badge on Plus. Cross-grade copy: `Already on Base? Move to Plus for 25% off — contact us.` — no discounted figure published.
- **Manual updates are part of a task, not a follow-up** (`CLAUDE.md` manual policy).

---

### Task 1: Private-LAN detection and the Field URL verdict

**Files:**
- Modify: `src/lib/fieldAccessUrl.ts` (whole file — 21 lines today)
- Modify: `src/lib/fieldAccessUrl.test.ts:6-35` (three `toEqual` assertions gain the new field)

**Interfaces:**
- Consumes: nothing.
- Produces: `isPrivateLan: boolean` on `FieldUrlClassification`; `type FieldUrlVerdict = "ok-lan" | "ok-tunnel" | "localhost" | "remote-needs-plus" | "public-plain-http"`; `fieldUrlVerdict(url: string, remoteLicensed: boolean): FieldUrlVerdict`. Task 3 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/fieldAccessUrl.test.ts`, and update the import line to `import { classifyFieldUrl, fieldUrlVerdict } from "@/lib/fieldAccessUrl";`:

```ts
describe("isPrivateLan", () => {
  test.each([
    "http://192.168.1.20:3000/field",
    "http://10.4.1.7:3000/field",
    "http://172.16.0.9:3000/field",
    "http://172.31.255.254:3000/field",
    "http://officepc.local:3000/field",
  ])("%s is private LAN", (url) => {
    expect(classifyFieldUrl(url).isPrivateLan).toBe(true);
  });

  // 172.15 and 172.32 sit just outside 172.16/12. A naive /^172\./ check would
  // wrongly treat public addresses in those ranges as the office LAN.
  test.each([
    "http://172.15.0.1:3000/field",
    "http://172.32.0.1:3000/field",
    "http://169.254.10.1:3000/field",
    "https://app.acme.com/field",
    "http://localhost:3000/field",
  ])("%s is not private LAN", (url) => {
    expect(classifyFieldUrl(url).isPrivateLan).toBe(false);
  });
});

describe("fieldUrlVerdict", () => {
  test("localhost is unusable on both plans", () => {
    expect(fieldUrlVerdict("http://localhost:3000/field", false)).toBe("localhost");
    expect(fieldUrlVerdict("http://localhost:3000/field", true)).toBe("localhost");
  });

  // The whole point of the Base plan: a plain-http LAN address is CORRECT and
  // must not raise the "credentials travel unencrypted" warning.
  test("LAN address is correct on both plans", () => {
    expect(fieldUrlVerdict("http://192.168.1.20:3000/field", false)).toBe("ok-lan");
    expect(fieldUrlVerdict("http://192.168.1.20:3000/field", true)).toBe("ok-lan");
  });

  test("public https is a tunnel on Plus, needs Plus on Base", () => {
    expect(fieldUrlVerdict("https://app.acme.com/field", true)).toBe("ok-tunnel");
    expect(fieldUrlVerdict("https://app.acme.com/field", false)).toBe("remote-needs-plus");
  });

  test("public plain http warns about plaintext on Plus, needs Plus on Base", () => {
    expect(fieldUrlVerdict("http://app.acme.com/field", true)).toBe("public-plain-http");
    expect(fieldUrlVerdict("http://app.acme.com/field", false)).toBe("remote-needs-plus");
  });
});
```

Also update the three existing `toEqual` blocks at lines 6, 18 and 30 — each object literal gains `isPrivateLan: false`. For example the first becomes:

```ts
    expect(classifyFieldUrl("https://acme.whitevanops.com/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: false,
      isHttps: true,
      isPrivateLan: false,
    });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/fieldAccessUrl.test.ts
```

Expected: FAIL — `fieldUrlVerdict is not a function`, and the three `toEqual` cases fail on the missing `isPrivateLan` key.

- [ ] **Step 3: Implement**

Replace the whole of `src/lib/fieldAccessUrl.ts` with:

```ts
export interface FieldUrlClassification {
  /** Host is localhost / 127.0.0.1 — unreachable from a phone. */
  isLocalhost: boolean;
  /** Plain http:// over a public host — credentials would travel unencrypted. */
  isPlainHttp: boolean;
  /** https:// — the shape the Plus tunnel produces. */
  isHttps: boolean;
  /** RFC1918 address or *.local name — the office LAN, i.e. Base's transport. */
  isPrivateLan: boolean;
}

/**
 * The five ways a Field Module URL can relate to the licensed transport.
 * A code, not a sentence: the decision table stays unit-testable here and the
 * user-facing copy stays in FieldAccessModal.
 */
export type FieldUrlVerdict =
  | "ok-lan"
  | "ok-tunnel"
  | "localhost"
  | "remote-needs-plus"
  | "public-plain-http";

function hostOf(url: string): string {
  // Hand-rolled rather than `new URL()`: this runs against a half-typed value
  // from a controlled input, and `new URL("http://19")` throwing mid-keystroke
  // would break the live classification.
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : "";
}

function isPrivateLanHost(host: string): boolean {
  if (host.endsWith(".local")) return true;

  const octets = host.split(".");
  if (octets.length !== 4) return false;
  const nums = octets.map((o) => Number(o));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  // 172.16.0.0/12 is 172.16 through 172.31 inclusive — NOT all of 172.x.
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Classifies a Field Module URL by transport shape so the QR flow can guide
 * the admin. Base serves the field module over the office LAN, so a private
 * address is the correct configuration there; Plus adds an HTTPS tunnel
 * hostname. localhost is never phone-reachable on either plan.
 */
export function classifyFieldUrl(url: string): FieldUrlClassification {
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
  const isHttps = /^https:\/\//i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url) && !isLocalhost;
  const isPrivateLan = !isLocalhost && isPrivateLanHost(hostOf(url));
  return { isLocalhost, isPlainHttp, isHttps, isPrivateLan };
}

/**
 * Maps a URL plus the remote-access entitlement onto the advice the admin
 * needs. `remoteLicensed` is Plus: only Plus installs ship cloudflared, so a
 * public hostname on Base cannot reach the office server at all.
 */
export function fieldUrlVerdict(url: string, remoteLicensed: boolean): FieldUrlVerdict {
  const { isLocalhost, isPrivateLan, isHttps } = classifyFieldUrl(url);
  if (isLocalhost) return "localhost";
  if (isPrivateLan) return "ok-lan";
  if (!remoteLicensed) return "remote-needs-plus";
  return isHttps ? "ok-tunnel" : "public-plain-http";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/fieldAccessUrl.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lib/fieldAccessUrl.ts src/lib/fieldAccessUrl.test.ts
git commit -m "feat(field-url): classify private-LAN addresses and add plan-aware verdict"
```

---

### Task 2: LAN address detection API

**Files:**
- Create: `src/app/api/field-access/lan-address/route.ts`
- Create: `src/app/api/field-access/lan-address/route.test.ts`

**Interfaces:**
- Consumes: `getSessionUser` and `requireRole` from `@/lib/auth`; `classifyFieldUrl` from Task 1.
- Produces: `GET /api/field-access/lan-address` → `{ addresses: string[] }`, best candidate first. Task 3 consumes it.

**Why this exists:** a tunnel hostname is stable; a LAN IP is not. If the router reboots and the office PC gets a new address, every tech's saved home-screen PWA URL dies at once. Letting the admin pick a detected address removes the typo failure mode; the DHCP-reservation instruction in Task 11 removes the drift failure mode.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/field-access/lan-address/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(),
  requireRole: vi.fn(),
}));

import { GET } from "./route";
import { getSessionUser, requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

describe("GET /api/field-access/lan-address", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("403s a tech", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "tech" } as never);
    vi.mocked(requireRole).mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns private IPv4 addresses and omits loopback and IPv6", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "admin" } as never);
    vi.mocked(requireRole).mockReturnValue(null);
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
      Ethernet: [
        { address: "192.168.1.20", family: "IPv4", internal: false } as never,
        { address: "fe80::1", family: "IPv6", internal: false } as never,
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ addresses: ["192.168.1.20"] });
  });

  it("prefers a private LAN address over a public one", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: "u1", role: "admin" } as never);
    vi.mocked(requireRole).mockReturnValue(null);
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      WAN: [{ address: "203.0.113.5", family: "IPv4", internal: false } as never],
      LAN: [{ address: "10.0.0.8", family: "IPv4", internal: false } as never],
    });

    const res = await GET();
    await expect(res.json()).resolves.toEqual({ addresses: ["10.0.0.8", "203.0.113.5"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/api/field-access/lan-address/route.test.ts
```

Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/field-access/lan-address/route.ts`:

```ts
import { NextResponse } from "next/server";
import os from "os";
import { getSessionUser, requireRole } from "@/lib/auth";
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";

/**
 * Reports the addresses a phone on the office network could use to reach this
 * server, so the Field Access QR flow can offer them instead of asking an
 * admin to type an IP. Read-only and admin-gated: it discloses internal
 * network layout, which a tech has no reason to enumerate.
 *
 * Private (RFC1918) addresses sort first — on a machine with both a LAN NIC
 * and something public, the LAN one is what field techs can actually reach.
 */
export async function GET() {
  const user = await getSessionUser();
  const denied = requireRole(user, "admin", "superuser");
  if (denied) return denied;

  const addresses: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const entry of iface ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(entry.address);
    }
  }

  const isPrivate = (addr: string) => classifyFieldUrl(`http://${addr}`).isPrivateLan;
  addresses.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));

  return NextResponse.json({ addresses });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/api/field-access/lan-address/route.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm no middleware change is needed**

```bash
grep -n "TECH_ALLOWED_PREFIXES\|PUBLIC_PATHS" src/middleware.ts
```

Expected: this route appears in neither list, which is correct — it needs a session and must not be reachable by a tech. Make no edit.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/field-access/lan-address
git commit -m "feat(api): detect server LAN addresses for the field access QR flow"
```

---

### Task 3: Plan-aware Field Access modal

**Files:**
- Modify: `src/components/modals/FieldAccessModal.tsx` (props, doc comment, warning block at lines 15-26 and 92-137)
- Modify: `src/app/page.tsx:1096` (pass the new prop; `plus` is already in scope from line 157)

**Interfaces:**
- Consumes: `fieldUrlVerdict` from Task 1; `GET /api/field-access/lan-address` from Task 2.
- Produces: `FieldAccessModal` now requires `isPlusLicensed: boolean`.

- [ ] **Step 1: Add the prop and update the doc comment**

In `src/components/modals/FieldAccessModal.tsx`, replace the `classifyFieldUrl` import, the `Props` interface, and the doc comment:

```tsx
import { fieldUrlVerdict } from "@/lib/fieldAccessUrl";

interface Props {
  onClose: () => void;
  /** Plus licences the HTTPS tunnel. Base serves the field module over the office LAN only. */
  isPlusLicensed: boolean;
}

const SETTING_KEY = "field_access_url";

/**
 * Shows a QR code pointing at the field module so techs can scan it with
 * their phone camera and install /field as a home-screen app. The URL is
 * persisted server-side (SystemSetting), not just this browser's
 * localStorage — otherwise a fresh browser/profile/device falls back to
 * `window.location.origin`, which on the Electron desktop app is always
 * `http://localhost:3000` and produces a QR code that only "works" on the
 * machine running the dashboard, never on a phone (ERR_CONNECTION_FAILED).
 *
 * The correct address depends on the plan. Base syncs over the office LAN, so
 * `http://<office-lan-ip>:3000/field` is right and must NOT be warned about as
 * insecure — it never leaves the building. Plus adds an HTTPS tunnel hostname.
 * QR generation is refused only while the URL is localhost, so a broken code is
 * never handed to a tech.
 */
export default function FieldAccessModal({ onClose, isPlusLicensed }: Props) {
```

- [ ] **Step 2: Add detected-address state and its fetch**

Add `const [detected, setDetected] = useState<string[]>([]);` alongside the existing `useState` calls at the top of the component — all hooks stay grouped before any conditional logic. Then, immediately after the existing `useEffect` that loads the `SystemSetting`, add:

```tsx
  useEffect(() => {
    let cancelled = false;
    fetch("/api/field-access/lan-address")
      .then((res) => res.json())
      .then((data: { addresses?: string[] }) => {
        if (!cancelled && Array.isArray(data?.addresses)) setDetected(data.addresses);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 3: Replace the classification call**

Replace `const { isLocalhost, isPlainHttp } = classifyFieldUrl(url);` with:

```tsx
  const verdict = fieldUrlVerdict(url, isPlusLicensed);
  const isLocalhost = verdict === "localhost";
```

`isLocalhost` is kept as a named local because the QR `useEffect` dependency array and the render guards below already reference it.

- [ ] **Step 4: Replace the two warning paragraphs**

Replace the `{isLocalhost && (...)}` and `{isPlainHttp && (...)}` blocks with:

```tsx
      {detected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span>Detected on this machine:</span>
          {detected.map((addr) => (
            <button
              key={addr}
              type="button"
              onClick={() => handleUrlChange(`http://${addr}:3000/field`)}
              className="font-mono px-2 py-1 rounded border border-zinc-300 hover:bg-zinc-100"
            >
              {addr}
            </button>
          ))}
        </div>
      )}

      {verdict === "localhost" && (
        <p className="text-[11px] text-red-600 leading-relaxed font-medium">
          This is a localhost address — a phone scanning it will get
          &quot;localhost is unreachable,&quot; not the field module. Use this
          machine&apos;s office-network address instead
          {isPlusLicensed ? ", or your tunnel address" : ""} — the QR code below
          is disabled until this is fixed.
        </p>
      )}
      {verdict === "ok-lan" && (
        <p className="text-[11px] text-emerald-700 leading-relaxed">
          Office-network address. Techs sync while on your WiFi; work done away
          from the building is held on the phone and saved when they return.
        </p>
      )}
      {verdict === "remote-needs-plus" && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is not an office-network address. Remote field access is a Plus
          feature — on this plan a phone can only reach the field module on your
          office WiFi, so this address will not connect. Use the detected
          address above.
        </p>
      )}
      {verdict === "public-plain-http" && (
        <p className="text-[11px] text-amber-600 leading-relaxed">
          This is a public <span className="font-mono">http://</span> address —
          credentials would travel unencrypted over the internet. Use the{" "}
          <span className="font-mono">https://</span> tunnel address so logins
          are encrypted and the session cookie is accepted.
        </p>
      )}
```

- [ ] **Step 5: Make the placeholder plan-appropriate**

```tsx
          placeholder={isPlusLicensed ? "https://acme.whitevanops.com/field" : "http://192.168.1.20:3000/field"}
```

- [ ] **Step 6: Pass the prop from the dashboard**

In `src/app/page.tsx`, change line 1096:

```tsx
        <FieldAccessModal onClose={closeModal} isPlusLicensed={plus} />
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm run lint
```

Expected: both clean. A `tsc` error naming `isPlusLicensed` means a second render site exists — run `grep -rn "FieldAccessModal" src/` and pass the prop there too.

- [ ] **Step 8: Commit**

```bash
git add src/components/modals/FieldAccessModal.tsx src/app/page.tsx
git commit -m "feat(field-access): plan-aware URL guidance and detected LAN addresses"
```

---

### Task 4: Sync status derivation

**Files:**
- Create: `src/lib/syncStatus.ts`
- Create: `src/lib/syncStatus.test.ts`

**Interfaces:**
- Consumes: `DrainResult` from `@/lib/offlineWrite` as a **type-only** import (`import type`), so no IndexedDB-touching module is pulled into the Node test environment at runtime.
- Produces: `type SyncStatus` (discriminated union on `kind`: `"idle" | "draining" | "pending" | "waiting-network" | "waiting-server" | "auth"`), `interface SyncStatusInput`, and `deriveSyncStatus(input: SyncStatusInput): SyncStatus`. Task 5 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/syncStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveSyncStatus } from "@/lib/syncStatus";

const base = { pendingCount: 0, isDraining: false, lastStop: null, lastSyncedAt: null } as const;

describe("deriveSyncStatus", () => {
  it("is idle with no queue and no history", () => {
    expect(deriveSyncStatus(base)).toEqual({ kind: "idle", lastSyncedAt: null });
  });

  it("keeps the last-saved timestamp when the queue is empty", () => {
    expect(deriveSyncStatus({ ...base, lastSyncedAt: 1753000000000 })).toEqual({
      kind: "idle",
      lastSyncedAt: 1753000000000,
    });
  });

  it("reports draining while a drain is in flight", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 3, isDraining: true })).toEqual({
      kind: "draining",
      pendingCount: 3,
    });
  });

  // Nothing has been attempted yet, so claiming the office network is missing
  // would be a guess. Say only what is known: work is waiting.
  it("reports plain pending before any drain has been attempted", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 2 })).toEqual({
      kind: "pending",
      pendingCount: 2,
    });
  });

  // The bug this module exists to fix: an unreachable office server used to
  // render an amber "Syncing..." badge forever.
  it("reports waiting-network when the server was unreachable", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 2, lastStop: "unreachable" })).toEqual({
      kind: "waiting-network",
      pendingCount: 2,
    });
  });

  it("reports waiting-server on a transient rejection", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 1, lastStop: "retry" })).toEqual({
      kind: "waiting-server",
      pendingCount: 1,
    });
  });

  it("reports auth when the session expired", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 4, lastStop: "auth" })).toEqual({
      kind: "auth",
      pendingCount: 4,
    });
  });

  it("treats a completed drain with leftovers as plain pending", () => {
    expect(deriveSyncStatus({ ...base, pendingCount: 1, lastStop: "complete" })).toEqual({
      kind: "pending",
      pendingCount: 1,
    });
  });

  it("prefers idle over any stale stop reason once the queue empties", () => {
    expect(deriveSyncStatus({ ...base, lastStop: "unreachable", lastSyncedAt: 5 })).toEqual({
      kind: "idle",
      lastSyncedAt: 5,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/syncStatus.test.ts
```

Expected: FAIL — cannot resolve `@/lib/syncStatus`.

- [ ] **Step 3: Implement**

Create `src/lib/syncStatus.ts`:

```ts
import type { DrainResult } from "./offlineWrite";

// ---------------------------------------------------------------------------
// What the field module tells a tech about unsent work.
//
// This replaces a boolean. The old UI rendered an amber "Syncing..." badge
// whenever the queue was non-empty and `navigator.onLine` was true — so a tech
// off-site all day, with full signal and an unreachable office server, watched
// "Syncing..." indefinitely while nothing synced. On the Base plan, where the
// office WiFi IS the transport, "we cannot see the office" is the single most
// important thing to say out loud.
// ---------------------------------------------------------------------------

export type SyncStatus =
  | { kind: "idle"; lastSyncedAt: number | null }
  | { kind: "draining"; pendingCount: number }
  | { kind: "pending"; pendingCount: number }
  | { kind: "waiting-network"; pendingCount: number }
  | { kind: "waiting-server"; pendingCount: number }
  | { kind: "auth"; pendingCount: number };

export interface SyncStatusInput {
  /** Rows currently in the IndexedDB syncQueue (never counts stuckOps). */
  pendingCount: number;
  isDraining: boolean;
  /** Why the most recent drain stopped, or null if none has run this session. */
  lastStop: DrainResult["stopped"] | null;
  /** Epoch ms of the last drain that reached the server, from localStorage. */
  lastSyncedAt: number | null;
}

export function deriveSyncStatus({
  pendingCount,
  isDraining,
  lastStop,
  lastSyncedAt,
}: SyncStatusInput): SyncStatus {
  // An empty queue outranks every stop reason: a stale "unreachable" from
  // earlier must not keep warning about work that has since been saved.
  if (pendingCount === 0) return { kind: "idle", lastSyncedAt };
  if (isDraining) return { kind: "draining", pendingCount };
  if (lastStop === "unreachable") return { kind: "waiting-network", pendingCount };
  if (lastStop === "retry") return { kind: "waiting-server", pendingCount };
  if (lastStop === "auth") return { kind: "auth", pendingCount };
  // null (nothing attempted yet) or "complete" with leftovers. Neither
  // justifies naming a cause, so say only that work is waiting.
  return { kind: "pending", pendingCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/syncStatus.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/syncStatus.ts src/lib/syncStatus.test.ts
git commit -m "feat(field-sync): derive honest sync status instead of a boolean"
```

---

### Task 5: Field page sync status bar and component extraction

**Files:**
- Create: `src/components/field/StuckOpsPanel.tsx` (moved verbatim from `src/app/field/page.tsx:613-730`)
- Create: `src/components/field/SyncStatusBar.tsx`
- Modify: `src/app/field/page.tsx` (state at 738-749, `processSync` at 758-784, mount effect at 786, header badges at 968-977)

**Interfaces:**
- Consumes: `deriveSyncStatus` and `SyncStatus` from Task 4.
- Produces: nothing consumed by later tasks.

`src/app/field/page.tsx` is 1091 lines against the 800-line ceiling in the coding-style rules, and this task edits it. The extraction in Steps 1-2 is a pure move, committed separately so a later bisect can tell it apart from the behaviour change.

- [ ] **Step 1: Extract StuckOpsPanel with no behaviour change**

Cut the `StuckOpsPanel` function (starts `function StuckOpsPanel({` at line 613, ends at its closing brace before the next top-level declaration) into a new file `src/components/field/StuckOpsPanel.tsx`. Add `"use client";` as line 1 and `export default` before `function StuckOpsPanel`. Move with it everything only it uses: `describeStuckOp` (line 99) and the `discardStuckOp` / `retargetStuckOp` / `handoffStuckOp` imports from `@/lib/syncResolution`. Import `type StuckOp` from `@/lib/idb` in the new file. If `FieldJob` is declared in `page.tsx`, add `export` to its declaration there and import it in the new file.

In `page.tsx`, delete the moved declarations and their now-unused imports, then add:

```tsx
import StuckOpsPanel from "@/components/field/StuckOpsPanel";
```

- [ ] **Step 2: Verify the move changed nothing, then commit it alone**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean, with the same test count as before this task.

```bash
git add src/components/field/StuckOpsPanel.tsx src/app/field/page.tsx
git commit -m "refactor(field): extract StuckOpsPanel out of page.tsx"
```

- [ ] **Step 3: Write the SyncStatusBar component**

Create `src/components/field/SyncStatusBar.tsx`:

```tsx
"use client";

import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import type { SyncStatus } from "@/lib/syncStatus";

interface Props {
  status: SyncStatus;
  onSyncNow: () => void;
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Tells a tech whether their work has reached the office. On the Base plan the
 * office WiFi is the only transport, so "we can't see the office yet" is normal
 * and must read as normal — not as an error, and never as "Syncing..." when
 * nothing is syncing.
 */
export default function SyncStatusBar({ status, onSyncNow }: Props) {
  if (status.kind === "idle") {
    if (status.lastSyncedAt === null) return null;
    return (
      <p className="text-[10px] text-zinc-500 px-4 py-1">
        Last saved to office {formatTime(status.lastSyncedAt)}
      </p>
    );
  }

  const n = status.pendingCount;
  const entries = `${n} change${n === 1 ? "" : "s"}`;

  if (status.kind === "draining") {
    return (
      <p className="text-[10px] text-amber-500 px-4 py-1 flex items-center gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" /> Saving {entries} to office…
      </p>
    );
  }

  if (status.kind === "auth") {
    return (
      <p className="text-[10px] text-red-300 px-4 py-1 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {entries} waiting — sign in again to save
      </p>
    );
  }

  const detail =
    status.kind === "waiting-network"
      ? "office network not found"
      : status.kind === "waiting-server"
        ? "office server busy"
        : "waiting to save";

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1">
      <p className="text-[10px] text-amber-500 flex items-center gap-1">
        <CloudOff className="h-3 w-3" /> {entries} · {detail}
      </p>
      <button
        type="button"
        onClick={onSyncNow}
        className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
      >
        Try now
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Rewire the field page state**

In `src/app/field/page.tsx`, add at module scope, above `export default function FieldPage()`:

```tsx
const LAST_SYNCED_KEY = "wvo.lastSyncedAt";
```

Add to the imports:

```tsx
import { deriveSyncStatus } from "@/lib/syncStatus";
import SyncStatusBar from "@/components/field/SyncStatusBar";
import type { DrainResult } from "@/lib/offlineWrite";
```

Replace `const [pendingSync, setPendingSync] = useState(false);` (line 739) with:

```tsx
  const [pendingCount, setPendingCount] = useState(0);
  const [lastStop, setLastStop] = useState<DrainResult["stopped"] | null>(null);
  const [isDraining, setIsDraining] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
```

Replace the body of `checkSyncStatus` so it sets the count rather than a boolean:

```tsx
  const checkSyncStatus = async () => {
    try {
      const q = await getSyncQueue();
      setPendingCount(q.length);
      setStuckOps(await getStuckOps());
    } catch { }
  };
```

- [ ] **Step 5: Record drain outcomes in processSync**

Replace the body of `processSync` (lines 758-784) with:

```tsx
  const processSync = async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    try {
      const { synced, stuck, stopped } = await drainSyncQueue();
      setLastStop(stopped);
      if (synced > 0) {
        const now = Date.now();
        localStorage.setItem(LAST_SYNCED_KEY, String(now));
        setLastSyncedAt(now);
      }
      if (stopped === "auth") {
        showToast("Session expired. Log in again to sync your changes.", true);
        return;
      }
      if (synced === 0 && stuck === 0) return;
      checkSyncStatus();
      if (tech) loadJobs(tech.id);
      if (stuck > 0) {
        showToast(`${stuck} change${stuck === 1 ? "" : "s"} could not be saved and need${stuck === 1 ? "s" : ""} your attention.`, true);
      } else {
        showToast(
          stopped === "complete"
            ? "Background sync completed. All changes saved to server."
            : `Synced ${synced} change${synced === 1 ? "" : "s"}. The rest are still queued.`
        );
      }
    } catch (err) {
      console.error("Sync failed", err);
    } finally {
      isDrainingRef.current = false;
      setIsDraining(false);
    }
  };
```

`setLastStop` runs before every early return, which is what the status bar depends on. The `synced === 0 && stuck === 0` early return still skips `checkSyncStatus()` deliberately — the queue cannot have changed in that case, so re-reading it would be a wasted IndexedDB round trip.

- [ ] **Step 6: Load the stored timestamp on mount**

Inside the existing mount `useEffect` (line 786), immediately after `setIsOnline(navigator.onLine);`:

```tsx
    const stored = Number(localStorage.getItem(LAST_SYNCED_KEY));
    if (Number.isFinite(stored) && stored > 0) setLastSyncedAt(stored);
```

- [ ] **Step 7: Remove the misleading badge and render the bar**

Delete the `{pendingSync && isOnline && (...)}` block at lines 973-977 — the amber "Syncing…" badge this task exists to remove. Keep the `{!isOnline && ...}` Offline badge unchanged.

Immediately after the closing tag of the header element that contained those badges, add:

```tsx
      <SyncStatusBar
        status={deriveSyncStatus({ pendingCount, isDraining, lastStop, lastSyncedAt })}
        onSyncNow={processSync}
      />
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
grep -c "" src/app/field/page.tsx
```

Expected: clean type-check and lint, all tests pass, and the line count now under 800. A surviving reference to `pendingSync` will surface as a `tsc` error — remove it. If the count is still over 800, extract the next self-contained form component and say which one in the commit message.

- [ ] **Step 9: Commit**

```bash
git add src/components/field/SyncStatusBar.tsx src/app/field/page.tsx
git commit -m "feat(field): replace the always-on Syncing badge with honest sync status"
```

---

### Task 6: Signed trial plan stamp

**Files:**
- Modify: `src/lib/licenseCrypto.ts` (append after `verifyTrialUnlock`, line 94)
- Modify: `src/lib/licenseCrypto.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `LICENSE_SIGNING_SECRET`, `timingSafeEqualStrings`, `LicenseTier` — all already in this module.
- Produces: `signTrialPlan(plan: LicenseTier): string` and `verifyTrialPlan(plan: string | undefined, sig: string | undefined): LicenseTier`. **`verifyTrialPlan` returns the resolved tier, not a boolean** — it is the single place deciding a trial build's plan, and returning `"base"` for every unverifiable input makes failing closed the only possible outcome. Tasks 7 and 8 consume both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/licenseCrypto.test.ts`, adding `signTrialPlan, verifyTrialPlan` to its existing import from `@/lib/licenseCrypto`:

```ts
describe("trial plan stamp", () => {
  it("verifies a correctly signed base plan", () => {
    expect(verifyTrialPlan("base", signTrialPlan("base"))).toBe("base");
  });

  it("verifies a correctly signed plus plan", () => {
    expect(verifyTrialPlan("plus", signTrialPlan("plus"))).toBe("plus");
  });

  // The whole reason this is signed: a Base trial's bundled .env.local sits in
  // plain text on the prospect's disk. Editing "base" to "plus" must buy them
  // nothing, exactly as WVO_DEFAULT_TIER taught us.
  it("falls back to base when the plan was edited but the signature was not", () => {
    expect(verifyTrialPlan("plus", signTrialPlan("base"))).toBe("base");
  });

  it("falls back to base for a missing signature", () => {
    expect(verifyTrialPlan("plus", undefined)).toBe("base");
  });

  it("falls back to base for a missing plan", () => {
    expect(verifyTrialPlan(undefined, signTrialPlan("plus"))).toBe("base");
  });

  it("falls back to base for a garbage plan name", () => {
    expect(verifyTrialPlan("enterprise", signTrialPlan("plus"))).toBe("base");
  });

  it("falls back to base for a signature of the wrong length", () => {
    expect(verifyTrialPlan("plus", "deadbeef")).toBe("base");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/licenseCrypto.test.ts
```

Expected: FAIL — `signTrialPlan is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/licenseCrypto.ts`:

```ts
// ---------------------------------------------------------------------------
// Trial plan stamp (WVO_TRIAL_PLAN / WVO_TRIAL_PLAN_SIG in the bundled
// .env.local, written by scripts/electron-build.js).
//
// Trial builds are pre-activated — they skip the activation key entirely — so
// the plan a trial demonstrates has to come from the build. That makes it
// configuration, which is exactly what WVO_DEFAULT_TIER was, and exactly why
// this is signed: the stamp ships as plain text on the prospect's disk, so
// editing "base" to "plus" must grant nothing.
//
// verifyTrialPlan returns a tier rather than a boolean on purpose. Every
// unverifiable input resolves to "base", so there is no failure branch a
// caller can forget and default the other way.
// ---------------------------------------------------------------------------

/** Signs a trial build's plan stamp. Mirrored in scripts/electron-build.js. */
export function signTrialPlan(plan: LicenseTier): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`trial-plan:${plan}`)
    .digest("hex");
}

/**
 * Resolves a trial build's plan from its stamp. Fails closed to "base" for
 * anything absent, malformed, or unsigned — tampering can only ever cost
 * features, never grant them.
 */
export function verifyTrialPlan(
  plan: string | undefined,
  sig: string | undefined
): LicenseTier {
  if (plan !== "base" && plan !== "plus") return "base";
  if (typeof sig !== "string") return "base";
  if (!timingSafeEqualStrings(sig, signTrialPlan(plan))) return "base";
  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/licenseCrypto.test.ts
```

Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/licenseCrypto.ts src/lib/licenseCrypto.test.ts
git commit -m "feat(license): sign the trial plan stamp so it cannot grant Plus"
```

---

### Task 7: Trial builds honour the signed plan

**Files:**
- Modify: `src/lib/license.ts` (import at 7-16; precedence comment at 210-226; trial branch at 234-241)
- Modify: `src/lib/license.test.ts` (three new tests; correct the stale comment at 582-586)

**Interfaces:**
- Consumes: `verifyTrialPlan` and `signTrialPlan` from Task 6.
- Produces: no new exports. Behaviour change: an unconverted trial build's tier is now its verified stamp, defaulting to `base`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/license.test.ts`, mirroring the shape of the existing `"ignores WVO_DEFAULT_TIER=plus…"` test at line 285. Add `signTrialPlan` to the file's import from `@/lib/licenseCrypto`:

```ts
  // Regression, same family as WVO_DEFAULT_TIER: a Base trial's bundled
  // .env.local is plain text on the prospect's disk. Flipping WVO_TRIAL_PLAN to
  // "plus" without a matching signature must grant nothing.
  it("ignores an unsigned WVO_TRIAL_PLAN=plus and falls back to base", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_TRIAL_PLAN", "plus");
    vi.stubEnv("WVO_TRIAL_PLAN_SIG", "not-a-real-signature");

    // No activation files at all — a genuine, unconverted trial install.
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
    } as never);

    const license = await getLicense();
    expect(license.tier).toBe("base");
  });

  it("grants plus for a correctly signed WVO_TRIAL_PLAN=plus trial build", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_TRIAL_PLAN", "plus");
    vi.stubEnv("WVO_TRIAL_PLAN_SIG", signTrialPlan("plus"));

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
    } as never);

    const license = await getLicense();
    expect(license.tier).toBe("plus");
  });

  it("runs a base trial build on base features", async () => {
    vi.stubEnv("WVO_IS_TRIAL", "true");
    vi.stubEnv("WVO_TRIAL_PLAN", "base");
    vi.stubEnv("WVO_TRIAL_PLAN_SIG", signTrialPlan("base"));

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    vi.mocked(prisma.license.upsert).mockResolvedValue({
      id: LICENSE_ROW_ID,
      tier: "base",
      licenseKey: null,
      notes: null,
      activatedAt: null,
      expiresAt: null,
    } as never);

    const license = await getLicense();
    expect(license.tier).toBe("base");
  });
```

- [ ] **Step 2: Run tests to confirm the right ones fail**

```bash
npx vitest run src/lib/license.test.ts
```

Expected: `"ignores an unsigned WVO_TRIAL_PLAN=plus…"` and `"runs a base trial build on base features"` both FAIL with `expected 'plus' to be 'base'` — today every unconverted trial build is forced to Plus. The signed-plus case passes already, for the wrong reason.

- [ ] **Step 3: Implement the branch**

In `src/lib/license.ts`, add `verifyTrialPlan` to the import from `./licenseCrypto`. Then change the trial branch (lines 234-241) so the tier comes from the stamp:

```ts
  } else if (isTrialBuild && !baseLicense) {
    const trialStatus = getTrialStatus();
    targetTier = verifyTrialPlan(process.env.WVO_TRIAL_PLAN, process.env.WVO_TRIAL_PLAN_SIG);
    targetKey = "TRIAL-ACTIVE";
    targetNotes = "30-Day Evaluation Period";
    targetExpires = trialStatus.installedAt ? new Date(new Date(trialStatus.installedAt).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
    targetActivated = trialStatus.installedAt ? new Date(trialStatus.installedAt) : (row.activatedAt || new Date());
  } else if (baseLicense && baseLicense.tier === "plus") {
```

- [ ] **Step 4: Update the precedence comment**

In the tier-precedence comment block (lines 210-226), replace bullet 2 with:

```
  //   2. trial build, not yet converted — the plan its SIGNED stamp grants,
  //      for the 30-day evaluation. Only reachable when NO base license
  //      exists, i.e. a genuine trial install (trial builds skip activation).
  //      The stamp is HMAC-signed and verifyTrialPlan fails closed to "base",
  //      so editing WVO_TRIAL_PLAN in the bundled .env.local grants nothing —
  //      the WVO_DEFAULT_TIER lesson, applied to the one plan input that
  //      genuinely has to come from the build.
```

- [ ] **Step 5: Correct the stale comment in the test file**

The comment at `src/lib/license.test.ts:582-586` ends with "an unconverted trial is Plus by definition," which this task makes false. Replace that clause with:

```ts
  // That env var is gone; a trial build is now identified by WVO_IS_TRIAL alone
  // and its plan comes from the signed WVO_TRIAL_PLAN stamp, defaulting to base
  // when absent — as it is in this test.
```

Then check the test it describes still asserts the right tier:

```bash
npx vitest run src/lib/license.test.ts -t "signed for a different machine"
```

If it asserted Plus on the strength of "unconverted trial is Plus," stub a signed `WVO_TRIAL_PLAN=plus` in it — its subject is the machine-mismatched unlock file, not the plan, so the plan should be held constant rather than changed to `base`.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/license.ts src/lib/license.test.ts
git commit -m "feat(license): trial builds honour their signed plan, defaulting to base"
```

---

### Task 8: Four installers, no upgrade target

**Files:**
- Modify: `scripts/electron-build.js` (arg parsing 9-35; delete the `tier === 'upgrade'` branch at 53-148; cleanup comment 150-159; `.env.local` block 218-239; after the pgsql check at 263; packaging 265-266; after the assertions at 290)
- Delete: `upgrade_installer.cs`
- Modify: `package.json` (`scripts`)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the HMAC contract of `signTrialPlan` from Task 6 — re-implemented in plain JS here, because this script runs outside the TypeScript build. The input string `trial-plan:${plan}` must stay byte-identical to `src/lib/licenseCrypto.ts`, exactly as `signLicense`/`signLegacyLicense` are already mirrored in `electron/main.js`.
- Produces: four npm scripts and four named artifacts.

- [ ] **Step 1: Replace argument parsing**

Replace lines 9-35 of `scripts/electron-build.js` with:

```js
const args = process.argv.slice(2);
const isBase = args.includes('--base');
const isPlus = args.includes('--plus');
const isTrial = args.includes('--trial');

if (args.includes('--upgrade')) {
  console.error('\n❌ --upgrade was removed on 2026-07-24.');
  console.error('   There is no in-place Base→Plus upgrade any more: Base and Plus are separate');
  console.error('   products with different payloads (only Plus bundles cloudflared), so a licence');
  console.error('   patch would unlock Plus features on an install that physically cannot tunnel.');
  console.error('   A Base customer moving to Plus buys Plus and installs WhiteVanOps-Plus-Setup.exe.\n');
  process.exit(1);
}

if (isBase && isPlus) {
  console.error('\n❌ Pass exactly one of --base or --plus.\n');
  process.exit(1);
}

// The plan decides the payload (cloudflared present or absent) and, for trial
// builds, the pre-activated tier. It is required for --trial: defaulting it
// would let one mistyped flag ship a prospect the wrong plan.
let plan;
if (isTrial) {
  const planIdx = args.indexOf('--plan');
  plan = planIdx !== -1 ? args[planIdx + 1] : null;
  if (plan !== 'base' && plan !== 'plus') {
    console.error('\n❌ --trial requires --plan base or --plan plus.');
    console.error('   Usage: node scripts/electron-build.js --trial --plan base\n');
    process.exit(1);
  }
} else {
  if (!isBase && !isPlus) {
    console.error('\n❌ Pass --base, --plus, or --trial --plan base|plus.\n');
    process.exit(1);
  }
  plan = isPlus ? 'plus' : 'base';
}

const variant = isTrial ? 'trial' : 'full';

// Only Plus ships the tunnel binary. A Base install therefore cannot open a
// tunnel for two independent reasons — no Plus entitlement in its signed key,
// and no cloudflared on disk. Neither is a file a customer can edit.
const bundlesCloudflared = plan === 'plus';

const ARTIFACT_NAMES = {
  'full:base': 'WhiteVanOps-Base-Setup.exe',
  'full:plus': 'WhiteVanOps-Plus-Setup.exe',
  'trial:base': 'WhiteVanOps-Base-Trial-Setup.exe',
  'trial:plus': 'WhiteVanOps-Plus-Trial-Setup.exe',
};
const artifactName = ARTIFACT_NAMES[`${variant}:${plan}`];

console.log(`\nBuilding ${artifactName}  (variant=${variant} plan=${plan} cloudflared=${bundlesCloudflared})`);
```

- [ ] **Step 2: Delete the upgrade target**

Delete the entire block from the `// TARGET: Plus Upgrade Installer` banner through its `process.exit(0);` and closing brace (original lines 53-148). Then:

```bash
git rm --ignore-unmatch upgrade_installer.cs
rm -f upgrade_installer.cs
```

The script generated that file at build time and removed it in a `finally`, so it may be untracked or already absent — `--ignore-unmatch` keeps the command from failing either way.

- [ ] **Step 3: Fix the cleanup comment that references the deleted target**

Replace the comment at lines 150-159 with:

```js
// ==========================================
// TARGET: Full App Installer (Base / Plus / trial variants)
// ==========================================
// Clean only the temporary build output to preserve previously generated
// installers. Do NOT blanket-delete dist-electron/: the finished installers
// live here and they are built one variant at a time (four of them now), so a
// wipe would destroy artifacts this run cannot rebuild.
//
```

- [ ] **Step 4: Write the signed plan stamp into the bundled .env.local**

Replace the `.env.local` block (lines 218-239) with:

```js
// 4. Copy .env.local into standalone so Next.js loads it at runtime
const envSrc = path.join(root, '.env.local');
const envDest = path.join(standalone, '.env.local');
let envContent = '';
if (fs.existsSync(envSrc)) {
  envContent = fs.readFileSync(envSrc, 'utf8');
}

// Trial builds set WVO_IS_TRIAL so src/lib/trial.ts activates the 30-day lock,
// plus a SIGNED plan stamp so src/lib/license.ts knows which plan the trial
// demonstrates. The signature is the whole point: this file ships as plain text
// inside resources/nextjs/, and WVO_DEFAULT_TIER taught us that an unsigned plan
// value there is a one-word Notepad edit away from granting the paid tier.
// verifyTrialPlan() fails closed to "base", so tampering can only cost features.
//
// Non-trial builds still carry NO plan stamp at all — an activated install's
// tier comes only from its signed, machine-bound activation key
// (scripts/license-manager.js --tier base|plus).
//
// This must stay byte-identical to signTrialPlan() in src/lib/licenseCrypto.ts.
function signTrialPlan(planName) {
  const LICENSE_SIGNING_SECRET =
    process.env.LICENSE_SIGNING_SECRET ||
    'wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765';
  return require('crypto')
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`trial-plan:${planName}`)
    .digest('hex');
}

if (variant === 'trial') {
  envContent += `\nWVO_IS_TRIAL="true"\n`;
  envContent += `WVO_TRIAL_PLAN="${plan}"\n`;
  envContent += `WVO_TRIAL_PLAN_SIG="${signTrialPlan(plan)}"\n`;
}
fs.writeFileSync(envDest, envContent, 'utf8');
console.log(
  `\nCopied .env.local into standalone bundle${
    variant === 'trial'
      ? ` with WVO_IS_TRIAL and a signed WVO_TRIAL_PLAN="${plan}"`
      : ' (tier comes from the activation key)'
  }.`
);
```

**Secret mismatch check.** `src/lib/licenseCrypto.ts` hardcodes `LICENSE_SIGNING_SECRET` and does *not* read the env var. If `LICENSE_SIGNING_SECRET` is set in the build environment, the stamp is signed with a different secret than the app verifies with, and every trial build silently falls back to Base. Before building a trial:

```bash
node -e "console.log(process.env.LICENSE_SIGNING_SECRET ? 'SET — trial stamp will NOT verify' : 'unset — ok')"
```

If it is set, unset it for the build. Do not paper over this by deleting the fallback.

- [ ] **Step 5: Hard-fail a Plus build with no cloudflared**

After the existing pgsql check (line 263), add:

```js
// 6b. Verify the tunnel binary for Plus variants. Same failure mode as the
// pgsql check above: electron-builder silently skips a missing extraResources
// source, so without this a "Plus" installer would ship with no way to open a
// tunnel — the one capability that plan is sold on.
if (bundlesCloudflared && !fs.existsSync(path.join(root, 'cloudflared', 'cloudflared.exe'))) {
  console.error('\n❌ Error: cloudflared/cloudflared.exe not found — a Plus installer would ship WITHOUT the tunnel binary.');
  console.error('Download the Windows amd64 build from Cloudflare and place it at cloudflared/cloudflared.exe.');
  console.error('See MANUAL_Setup_Installation.md §1.\n');
  process.exit(1);
}
```

- [ ] **Step 6: Derive the per-variant electron-builder config**

Replace the packaging step (lines 265-266) with:

```js
// 7. Package with electron-builder using a per-variant config derived from
// package.json's "build" key. package.json stays the single source of truth;
// only the delta (artifact name, and cloudflared for Plus) is computed here, so
// the two cannot drift.
const builderConfig = JSON.parse(JSON.stringify(require(path.join(root, 'package.json')).build));
builderConfig.win.artifactName = artifactName;
if (bundlesCloudflared) {
  builderConfig.win.extraResources.push({ from: 'cloudflared', to: 'cloudflared' });
}
const builderConfigPath = path.join(root, '.next', `electron-builder.${variant}-${plan}.json`);
fs.writeFileSync(builderConfigPath, JSON.stringify(builderConfig, null, 2), 'utf8');
run(`npx electron-builder --win --config "${builderConfigPath}"`);
```

- [ ] **Step 7: Assert the payload in both directions**

After the existing 7b assertion loop (line 290), add:

```js
// 7b-ii. The tunnel binary must be present on Plus and ABSENT on Base. Both
// directions matter: electron-builder can silently drop it from a Plus build,
// and a Base build that accidentally ships it erases the boundary between the
// two products — a Base install would then need only a licence flip to tunnel.
const cloudflaredPacked = path.join(distElectron, unpackedDir, 'resources', 'cloudflared', 'cloudflared.exe');
if (bundlesCloudflared && !fs.existsSync(cloudflaredPacked)) {
  console.error('\n❌ Error: Plus packaged output is missing resources/cloudflared/cloudflared.exe — do not ship it.');
  process.exit(1);
}
if (!bundlesCloudflared && fs.existsSync(cloudflaredPacked)) {
  console.error('\n❌ Error: Base packaged output CONTAINS resources/cloudflared/cloudflared.exe — the Base plan must not ship the tunnel binary.');
  process.exit(1);
}
```

- [ ] **Step 8: Update npm scripts**

In `package.json`, replace the three `electron:build*` entries (keeping `electron:dev`) with:

```json
    "electron:build": "node scripts/electron-build.js --base",
    "electron:build:plus": "node scripts/electron-build.js --plus",
    "electron:build:trial": "node scripts/electron-build.js --trial --plan base",
    "electron:build:trial:plus": "node scripts/electron-build.js --trial --plan plus",
```

- [ ] **Step 9: Gitignore the tunnel binary**

Append to `.gitignore`:

```
# Portable cloudflared for Plus installers — see MANUAL_Setup_Installation.md §1
cloudflared/
```

- [ ] **Step 10: Verify argument handling without a full build**

```bash
node scripts/electron-build.js --upgrade --key WVO-TEST
node scripts/electron-build.js --trial
node scripts/electron-build.js --base --plus
```

Expected: each exits non-zero with its own message — the removed-upgrade notice, the missing-`--plan` error, the both-plans error. None should reach `npm run build`.

- [ ] **Step 11: Build all four artifacts**

Each run takes several minutes; run them in sequence:

```bash
npm run electron:build
npm run electron:build:plus
npm run electron:build:trial
npm run electron:build:trial:plus
ls dist-electron/*.exe
```

Expected: four files — `WhiteVanOps-Base-Setup.exe`, `WhiteVanOps-Plus-Setup.exe`, `WhiteVanOps-Base-Trial-Setup.exe`, `WhiteVanOps-Plus-Trial-Setup.exe`. Every run must clear its own 7b assertions with no error. If a Plus run stops on the cloudflared check, that is the check working — place the binary and re-run.

Each run rebuilds `win-unpacked/`, so the in-place assertions only ever describe the most recent variant. That is why they run inside each build rather than once at the end.

- [ ] **Step 12: Commit**

```bash
git add scripts/electron-build.js package.json .gitignore
git commit -m "feat(build): four installers by plan; drop the in-place upgrade target"
```

---

### Task 9: Mark the upgrade licence path as read-only legacy

**Files:**
- Modify: `src/lib/license.ts` (`verifyPlusLicense` doc at ~96; the read site at ~163)
- Modify: `src/app/api/license/route.ts` (the `plus_license.json` references at ~121 and ~196)
- Modify: `scripts/activate-dev.js` (above the `plus_license.json` write, ~43)

**Interfaces:** No signature changes. This task only records *why* dead-looking code stays.

The reader is deliberately kept so an install already converted by a `WhiteVanOps-Plus-Upgrade.exe` patch keeps working instead of silently dropping to Base on next launch — the same courtesy the legacy `license.json` shape already gets.

- [ ] **Step 1: Annotate `verifyPlusLicense`**

Replace its one-line doc comment in `src/lib/license.ts` with:

```ts
/**
 * Cryptographically verifies an offline Plus license upgrade against the active
 * Base license key.
 *
 * LEGACY, READ-ONLY as of 2026-07-24. The Plus Upgrade Installer that wrote
 * plus_license.json is gone: Base and Plus are now separate products with
 * different payloads (only Plus bundles cloudflared), so a licence patch would
 * unlock Plus features on an install that physically cannot tunnel. No new
 * plus_license.json is ever minted. This stays only so an install already
 * patched in the field keeps working rather than silently dropping to Base.
 * Remove once no such install remains.
 */
```

- [ ] **Step 2: Annotate the read site**

Above `// 2. Read plus_license.json if present`:

```ts
  // Legacy read-only path — see verifyPlusLicense. No new patches are minted.
```

- [ ] **Step 3: Annotate the API route**

In `src/app/api/license/route.ts`, above each `plus_license.json` reference:

```ts
    // Legacy read-only path (2026-07-24): the Plus Upgrade Installer is gone.
    // Kept so an install already patched in the field keeps working.
```

The downgrade branch that *deletes* the file stays functional — removing a stale legacy file is still correct behaviour.

- [ ] **Step 4: Annotate the dev helper**

In `scripts/activate-dev.js`, above the `plus_license.json` write:

```js
  // Dev convenience only. This exercises the LEGACY plus_license.json path
  // (see src/lib/license.ts) — customers never receive one any more. To mirror
  // a real Plus customer instead, mint a Plus key:
  //   node scripts/license-manager.js --tier plus
```

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run
npx tsc --noEmit
git add src/lib/license.ts src/app/api/license/route.ts scripts/activate-dev.js
git commit -m "docs(license): mark plus_license.json as read-only legacy"
```

---

### Task 10: Website pricing and transport copy

**Files:**
- Modify: `marketing/index.html` (line 7 meta description; line 471 body copy; lines 550-601 pricing cards and tier note)
- Modify: `marketing/AlternateWebsites/option-a-ledger.html` (lines 568, 582-583 and the equivalent card markup)

**Interfaces:** None. Static HTML.

Feature sets do not change. Leave every `fcard`, the "Eight modules on Base. Three more on Plus." headline, and all three Plus module descriptions untouched.

- [ ] **Step 1: Add the Base transport bullet**

In `marketing/index.html`, inside the `Single Office Base` card's `<ul>`, after `<li>Admin dashboard + field module</li>`:

```html
          <li>WiFi sync — techs' phones offload work on your office network</li>
```

- [ ] **Step 2: Rewrite the Plus card head and price**

Replace lines 563-564:

```html
        <div class="pn" style="color:var(--blue)">Single Office Plus</div>
        <div class="pv">$1,000 <small>one-time</small></div>
```

The `<span class="plus-badge">Upgrade</span>` and the `+$500` / "one-time upgrade to Base · $1,000 for a fresh Base + Plus install" subtitle both disappear. Leave the `.plus-badge` CSS rule and its other uses (the module cards and the nav mini-badges) alone.

- [ ] **Step 3: Add the Plus transport bullet**

In the Plus card's `<ul>`, after `<li>Everything in Base</li>`:

```html
          <li>Secure remote tunnel — encrypted field access from anywhere</li>
```

- [ ] **Step 4: Replace the tier note**

Replace the contents of `<div class="tier-note reveal">` (line 601):

```html
      <b>Two plans, bought once:</b> Base runs entirely on your own network — techs' phones sync over your office WiFi and nothing leaves the building. Plus adds CRM notes &amp; follow-ups, business analytics, invoicing, and a secure encrypted tunnel so techs can work from anywhere. Both are one-time purchases, licensed to you for life with no subscription and nothing to renew. Already on Base? Move to Plus for 25% off — contact us. However you buy, your data always belongs to you.
```

- [ ] **Step 5: Fix the White Glove line**

Replace `<li>Field-access router configuration</li>`:

```html
          <li>Field access setup — office WiFi sync or secure tunnel</li>
```

Port forwarding was abandoned, so the old line advertises a service no longer performed.

- [ ] **Step 6: Fix the two copy lines that sell the removed upgrade path**

Line 7 meta description — replace `and upgrade to Plus for CRM follow-ups, business analytics, and invoicing` with:

```
and choose Plus for CRM follow-ups, business analytics, invoicing, and secure remote field access
```

Line 471 — replace `the three <span class="plus-badge" style="vertical-align:1px">Plus</span> cards are a paid upgrade you can add whenever your business is ready` with:

```html
the three <span class="plus-badge" style="vertical-align:1px">Plus</span> cards come with the Plus plan
```

- [ ] **Step 7: Apply the same edits to the alternate site**

`marketing/AlternateWebsites/option-a-ledger.html` carries the same cards: `$500` at line 568, `+$500` at 582, the upgrade subtitle at 583. Apply Steps 1-6 to its equivalent markup, using its own class names (`.pv`, `.pu`) rather than copying `index.html`'s. Then confirm the two agree:

```bash
grep -n "1,000\|+\$500\|Upgrade\|WiFi sync\|remote tunnel" marketing/index.html marketing/AlternateWebsites/option-a-ledger.html
```

Expected: both show `$1,000`, a WiFi-sync bullet and a remote-tunnel bullet; neither shows `+$500` or an "Upgrade" badge on the Plus *pricing* card.

- [ ] **Step 8: Check both pages render**

```bash
npx serve marketing -l 4173
```

Open `http://localhost:4173/index.html` and `http://localhost:4173/AlternateWebsites/option-a-ledger.html`. Confirm four pricing cards on each, Base $500, Plus $1,000 with no badge, both new bullets present, and no layout break where the Plus subtitle was removed. Stop the server when done.

- [ ] **Step 9: Commit**

```bash
git add marketing/index.html marketing/AlternateWebsites/option-a-ledger.html
git commit -m "docs(marketing): Base WiFi sync, Plus tunnel, Plus at 1000 with no upgrade badge"
```

---

### Task 11: Manuals and CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Commands block; License/Plus tier section; Transport paragraph; Trial/Demo section)
- Modify: `MANUAL_Setup_Installation.md`, `MANUAL_Field_Tech.md`, `MANUAL_Administrator.md`, `MANUAL_Troubleshooting.md`
- Modify: `docs/launch-checklist.md`

**Interfaces:** None.

`CLAUDE.md` currently asserts the *opposite* of this design in several places, so these are corrections rather than additions. Locate them first:

```bash
grep -n "SAME installer\|electron:build\|--plus\|no --plus build target\|electron:build:plus no longer exists\|port forwarding is impossible\|WVO_IS_TRIAL\|pre-activated on Plus" CLAUDE.md
```

- [ ] **Step 1: Fix the Commands block**

Replace the `electron:build` lines with:

```bash
npm run electron:build            # Base installer      → dist-electron/WhiteVanOps-Base-Setup.exe
npm run electron:build:plus       # Plus installer      → dist-electron/WhiteVanOps-Plus-Setup.exe (bundles cloudflared)
npm run electron:build:trial      # Base 30-day trial   → dist-electron/WhiteVanOps-Base-Trial-Setup.exe
npm run electron:build:trial:plus # Plus 30-day trial   → dist-electron/WhiteVanOps-Plus-Trial-Setup.exe
```

- [ ] **Step 2: Rewrite the "same installer" claim**

In the License/Plus tier section, replace the bullet asserting *"Consequence: Base and Plus are the SAME installer (`WhiteVanOps-Setup.exe`) and the key decides — there is no `--plus` build target and `electron:build:plus` no longer exists"* with:

```markdown
- **Base and Plus are separate installers, but the key still decides entitlement** (changed
  2026-07-24). The tier still travels only inside the signed activation key — no build flag grants
  a feature. What differs between the artifacts is *payload*: `WhiteVanOps-Plus-Setup.exe` bundles
  `cloudflared` via `extraResources`, `WhiteVanOps-Base-Setup.exe` does not. So a Base install
  cannot open a tunnel for two independent reasons — no entitlement and no binary — and
  `scripts/electron-build.js` asserts the binary's presence on Plus **and its absence on Base**.
- **There is no in-place Plus upgrade.** `--upgrade`, `upgrade_installer.cs` and
  `electron:build:upgrade` were removed 2026-07-24: a licence patch would unlock Plus features on
  an install with no `cloudflared`. A Base customer moving to Plus buys Plus (25% off) and installs
  the Plus artifact. `verifyPlusLicense` and the `plus_license.json` reader stay as **read-only
  legacy** so an install already patched in the field keeps working.
```

- [ ] **Step 3: Rewrite the Transport paragraph**

Replace it with:

```markdown
**Transport is per-plan** (2026-07-24, `docs/superpowers/specs/2026-07-24-wifi-sync-base-tier-design.md`).
**Base** serves the field module over the office LAN only: techs load
`http://<office-lan-ip>:3000/field`, the existing IndexedDB queue holds writes made away from the
building, and they drain when the phone rejoins the office WiFi. Base requires a DHCP reservation or
static IP for the office PC — the saved PWA URL is a bare address, so a router reboot that moves it
breaks every tech at once. **Plus** adds the Cloudflare tunnel (still provisioned by runbook, not
code) for access from anywhere. `src/lib/fieldAccessUrl.ts`'s `fieldUrlVerdict()` encodes which
address shape is correct on which plan; a private-LAN plain-http URL is **correct** on both and must
never raise the plaintext warning. The per-request cookie `secure` logic above is correct for both
and needs no change.
```

- [ ] **Step 4: Update the Trial/Demo section**

The claim that trial builds are "pre-activated on Plus" is now only half true. Add:

```markdown
- **A trial build's plan comes from a signed stamp** (2026-07-24). `electron-build.js --trial --plan
  base|plus` writes `WVO_TRIAL_PLAN` plus an HMAC `WVO_TRIAL_PLAN_SIG` into the bundled `.env.local`;
  `verifyTrialPlan()` in `src/lib/licenseCrypto.ts` returns the tier and **fails closed to `base`**
  for anything absent or edited. This is the one plan input that genuinely has to come from the build
  (trial installs skip activation entirely), which is exactly why it is signed — an unsigned one
  would be `WVO_DEFAULT_TIER` again. `src/lib/license.test.ts` carries the regression test
  *"ignores an unsigned WVO_TRIAL_PLAN=plus and falls back to base"*. A Base trial demos WiFi sync
  only and ships no `cloudflared`.
```

- [ ] **Step 5: Update `MANUAL_Setup_Installation.md`**

- §1 (portable binaries): add recreating `cloudflared/cloudflared.exe` beside the `pgsql/` steps, noting it is required only for the two Plus artifacts.
- Build section: the four commands and artifact names from Step 1.
- **Delete the Plus Upgrade Installer section** (the one describing the `.exe` patcher and placing `plus_license.json` in `%APPDATA%\whitevanops\`). Replace with one line: moving from Base to Plus means purchasing Plus and installing `WhiteVanOps-Plus-Setup.exe`; the database in `%APPDATA%` is untouched by reinstalling.
- New Base field-access subsection: find the office PC's LAN address via Settings → Field Access QR (**Use detected address**), set a **DHCP reservation or static IP** for that PC — required, not advisory — then have techs scan the QR while on the office WiFi and Add to Home Screen.
- Note the artifact rename from `WhiteVanOps Setup <version>.exe` to `WhiteVanOps-Base-Setup.exe`.

- [ ] **Step 6: Update `MANUAL_Field_Tech.md`**

Document the status line under the header: what "3 changes · office network not found" means (normal away from the building — work is safe on the phone and saves on return), what "office server busy" means, what "Last saved to office 2:14pm" confirms, and that **Try now** asks it to retry immediately. State plainly that on the Base plan the app only reaches the office on the office WiFi, and that closing the app does not lose queued work.

- [ ] **Step 7: Update `MANUAL_Administrator.md`**

In the Field Access QR section: the **Use detected address** buttons; that a `192.168.x` / `10.x` / `172.16-31.x` address is correct on Base and shows a green confirmation; that a public address on Base warns remote access is a Plus feature; and that the QR is withheld only for a localhost address.

- [ ] **Step 8: Update `MANUAL_Troubleshooting.md`**

Add "A tech's work isn't reaching the office (Base)", in order of likelihood: the phone is not on the office WiFi; the office PC's LAN address changed after a router reboot (symptom: worked yesterday, now fails for *every* tech at once — fix with a DHCP reservation and re-issue the QR); the office PC is off; the session expired ("sign in again to save"); entries need attention via the stuck-record panel. State that queued work is not lost while any of these are true.

- [ ] **Step 9: Update `docs/launch-checklist.md`**

Phase 4 frames plain-HTTP field access as temporary pending the tunnel. Add that as of 2026-07-24 this splits by plan: on **Base**, LAN HTTP is the permanent design and carries no public-internet exposure because the traffic never leaves the building; the tunnel item now applies to **Plus** only.

- [ ] **Step 10: Verify no stale claims survive**

```bash
grep -rn "SAME installer\|electron:build:upgrade\|Plus Upgrade Installer\|WhiteVanOps-Setup.exe\|there is no --plus" CLAUDE.md MANUAL_*.md docs/launch-checklist.md
```

Expected: no hits outside a sentence explicitly marked as removed/legacy history.

- [ ] **Step 11: Commit**

```bash
git add CLAUDE.md MANUAL_Setup_Installation.md MANUAL_Field_Tech.md MANUAL_Administrator.md MANUAL_Troubleshooting.md docs/launch-checklist.md
git commit -m "docs: per-plan transport, four installers, no upgrade path"
```

---

### Task 12: Final verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Full automated suite**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: all pass. Record the test count.

- [ ] **Step 2: Confirm the tamper guard actually holds**

On a machine with the Base trial installed, edit `<install dir>\resources\nextjs\.env.local`, change `WVO_TRIAL_PLAN="base"` to `"plus"`, restart the app, log in. Expected: Analytics and Invoicing stay hidden and `GET /api/analytics` returns 403. If Plus appears, stop — the signing secret differs between build and runtime (Task 8 Step 4).

- [ ] **Step 3: Base end-to-end on a real phone**

With `WhiteVanOps-Base-Setup.exe` installed and activated with a Base key: open Settings → Field Access QR, click a detected address, confirm the green office-network message and a QR. On a phone joined to the office WiFi, scan it, log in, log time against a job, confirm it appears in the dashboard. Leave the WiFi (cellular only), log time again, confirm the status line reads "1 change · office network not found". Rejoin the WiFi, confirm it drains and "Last saved to office" updates.

- [ ] **Step 4: The standing regression**

Open the Electron desktop app and log in over `http://localhost:3000`. Expected: login succeeds and does not bounce back to `/login`. This is the failure the per-request cookie `secure` logic exists to prevent, and it must be re-checked after any auth-adjacent change.

- [ ] **Step 5: Walk the spec's verification checklist**

Open `docs/superpowers/specs/2026-07-24-wifi-sync-base-tier-design.md` and tick each box under "Verification criteria", or record why one could not be checked. Do not tick from inference — every line names something observable.

- [ ] **Step 6: Commit any fixes**

```bash
git status
```

If Steps 1-4 required changes, commit them with a `fix:` message naming the check that caught the problem.

---

## Self-Review

**Spec coverage:** Payload/entitlement split → Task 8. Field URL classification → Tasks 1, 3. Stable LAN addressing → Tasks 2, 3, and Task 11 Steps 5/8. Field sync status → Tasks 4, 5. In-scope `page.tsx` cleanup → Task 5 Steps 1-2. Signed trial plan → Tasks 6, 7. Installer matrix → Task 8. Upgrade removal → Task 8 (build side) and Task 9 (legacy annotations). Website → Task 10. Docs → Task 11. Testing and the spec's verification criteria → distributed, then Task 12.

**Known gap, deliberate:** the spec's build-level check ("all four variants produce the named artifact with `cloudflared` present/absent") is enforced by assertions *inside* `electron-build.js` (Task 8 Steps 5/7) and exercised by the four real builds in Step 11, not by a Vitest test. `vitest.config.ts` only collects `src/**/*.test.ts`, and a unit test of the build script would have to mock electron-builder — proving nothing about what actually landed in the artifact, which is the only thing that matters here.

**Type consistency:** `fieldUrlVerdict(url, remoteLicensed): FieldUrlVerdict` — same name and arity in Tasks 1 and 3. `deriveSyncStatus(SyncStatusInput): SyncStatus` with `kind` values `idle | draining | pending | waiting-network | waiting-server | auth` — identical in Tasks 4 and 5. `verifyTrialPlan(plan, sig): LicenseTier` returns a tier, not a boolean, in Tasks 6, 7 and 8, and the HMAC input `trial-plan:${plan}` is byte-identical in the TypeScript and the mirrored plain-JS copy. `GET /api/field-access/lan-address` returns `{ addresses: string[] }` in Tasks 2 and 3. `LAST_SYNCED_KEY = "wvo.lastSyncedAt"` is used consistently across Task 5 Steps 4-6.
