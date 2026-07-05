import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { name, serialNumber, status } = await request.json();

    if (!name || !serialNumber || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existing = await prisma.equipment.findUnique({ where: { serialNumber } });
    if (existing) {
      return NextResponse.json({ error: "Equipment with this serial number already exists" }, { status: 400 });
    }

    const newEquipment = await prisma.equipment.create({ data: { name, serialNumber, status } });

    await audit(user!.userId, "CREATE", "Equipment", newEquipment.id, { name, serialNumber });

    return NextResponse.json(newEquipment);
  } catch (error) {
    console.error("Create Equipment API Error:", error);
    return NextResponse.json({ error: "Failed to create equipment" }, { status: 500 });
  }
}
