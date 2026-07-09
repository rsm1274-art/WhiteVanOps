import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getLicense, isPlusActive, LICENSE_ROW_ID } from "@/lib/license";

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const license = await getLicense();
    return NextResponse.json({ ...license, plus: isPlusActive(license) });
  } catch (error) {
    console.error("License GET API Error:", error);
    return NextResponse.json({ error: "Failed to read license" }, { status: 500 });
  }
}

// Superuser-only (stricter than admin): flipping the plan is a business-level
// action, not day-to-day operations.
export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "superuser");
  if (err) return err;

  try {
    const { tier, licenseKey, notes, expiresAt } = await request.json();

    if (tier !== "base" && tier !== "plus") {
      return NextResponse.json({ error: "tier must be 'base' or 'plus'" }, { status: 400 });
    }
    let expires: Date | null = null;
    if (expiresAt) {
      expires = new Date(expiresAt);
      if (isNaN(expires.getTime())) {
        return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
      }
    }

    const data = {
      tier,
      licenseKey: licenseKey?.trim() || null,
      notes: notes?.trim() || null,
      expiresAt: expires,
      activatedAt: tier === "plus" ? new Date() : null,
    };
    const row = await prisma.license.upsert({
      where: { id: LICENSE_ROW_ID },
      update: data,
      create: { id: LICENSE_ROW_ID, ...data },
    });

    await audit(user!.userId, "UPDATE", "License", row.id, { tier });

    return NextResponse.json({
      tier: row.tier,
      licenseKey: row.licenseKey,
      notes: row.notes,
      activatedAt: row.activatedAt,
      expiresAt: row.expiresAt,
      plus: isPlusActive({ tier: row.tier, expiresAt: row.expiresAt }),
    });
  } catch (error) {
    console.error("License POST API Error:", error);
    return NextResponse.json({ error: "Failed to update license" }, { status: 500 });
  }
}
