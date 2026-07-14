import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
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

// Superuser-only: updating the license tier is a business-level action.
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

    if (tier !== "base" && tier !== "plus") {
      return NextResponse.json({ error: "tier must be 'base' or 'plus'" }, { status: 400 });
    }

    const appDataDir = getAppDataWvoDir();
    const plusPath = path.join(appDataDir, "plus_license.json");

    if (tier === "plus") {
      // 1. Resolve base license key
      const baseLicense = getBaseLicense();
      if (!baseLicense) {
        return NextResponse.json(
          { error: "Application is not activated. Base license must be active." },
          { status: 400 }
        );
      }

      // 2. Parse and validate Plus license payload
      let payload = body.licensePayload;
      if (!payload && body.licenseKey) {
        try {
          payload = JSON.parse(body.licenseKey.trim());
        } catch (e) {
          return NextResponse.json(
            { error: "Invalid license format. Must be a valid cryptographically signed JSON block." },
            { status: 400 }
          );
        }
      }

      if (!payload || !verifyPlusLicense(payload, baseLicense.key)) {
        return NextResponse.json(
          { error: "Invalid cryptographic signature. License is invalid or does not match this machine's activation key." },
          { status: 400 }
        );
      }

      // 3. Check for expiration
      const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() < Date.now()) {
        return NextResponse.json({ error: "The provided license has expired." }, { status: 400 });
      }

      // 4. Save license.json file to local filesystem
      if (!fs.existsSync(appDataDir)) {
        fs.mkdirSync(appDataDir, { recursive: true });
      }
      fs.writeFileSync(plusPath, JSON.stringify(payload, null, 2), "utf8");

      // 5. Update database state
      const data = {
        tier: "plus",
        licenseKey: payload.licenseKey,
        notes: payload.notes || null,
        expiresAt: expiresAt,
        activatedAt: new Date(),
      };
      const row = await prisma.license.upsert({
        where: { id: LICENSE_ROW_ID },
        update: data,
        create: { id: LICENSE_ROW_ID, ...data },
      });

      await audit(user!.userId, "UPDATE", "License", row.id, { tier: "plus" });

      return NextResponse.json({
        tier: row.tier,
        licenseKey: row.licenseKey,
        notes: row.notes,
        activatedAt: row.activatedAt,
        expiresAt: row.expiresAt,
        plus: true,
      });
    } else {
      // tier === "base" (Downgrade)
      // 1. Delete local file
      if (fs.existsSync(plusPath)) {
        try {
          fs.unlinkSync(plusPath);
        } catch (e) {
          console.error("Failed to delete local plus_license.json:", e);
        }
      }

      // 2. Reset database state
      const data = {
        tier: "base",
        activatedAt: null,
      };
      const row = await prisma.license.upsert({
        where: { id: LICENSE_ROW_ID },
        update: data,
        create: { id: LICENSE_ROW_ID, ...data },
      });

      await audit(user!.userId, "UPDATE", "License", row.id, { tier: "base" });

      return NextResponse.json({
        tier: row.tier,
        licenseKey: row.licenseKey,
        notes: row.notes,
        activatedAt: row.activatedAt,
        expiresAt: row.expiresAt,
        plus: false,
      });
    }
  } catch (error) {
    console.error("License POST API Error:", error);
    return NextResponse.json({ error: "Failed to update license" }, { status: 500 });
  }
}
