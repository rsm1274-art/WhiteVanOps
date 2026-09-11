import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole, setSessionCookie, signSessionToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getLicense, LICENSE_ROW_ID, getBaseLicense } from "@/lib/license";
import { getTrialStatus, verifyTrialUnlock, markTrialUnlocked, TrialUnlockPayload } from "@/lib/trial";
import { machineIdSync } from "node-machine-id";

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
      activeBaseKey: baseLicense ? baseLicense.key : null,
      trial,
    });
  } catch (error) {
    console.error("License GET API Error:", error);
    return NextResponse.json({ error: "Failed to read license" }, { status: 500 });
  }
}

// Superuser-only: converting a trial install is a business-level action.
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

      await audit(user!.userId, "UPDATE", "License", row.id, { action: "unlock-trial" });

      // Re-issue the session JWT: trialLocked is stamped ONLY at login and is
      // what edge middleware reads to redirect to /trial-expired. Without
      // re-signing here, a trial-locked user who successfully unlocks would
      // still carry trialLocked:true and get bounced right back.
      const trial = getTrialStatus();
      const token = await signSessionToken({
        userId: user!.userId,
        username: user!.username,
        displayName: user!.displayName,
        role: user!.role,
        personnelId: user!.personnelId,
        mustChangePassword: user!.mustChangePassword,
        trialLocked: trial.isLocked,
      });

      const res = NextResponse.json({
        licenseKey: row.licenseKey,
        notes: row.notes,
        activatedAt: row.activatedAt,
        expiresAt: row.expiresAt,
        trial,
      });
      setSessionCookie(res, token, request);
      return res;
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("License POST API Error:", error);
    return NextResponse.json({ error: "Failed to update license" }, { status: 500 });
  }
}
