import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

const VALID_FREQUENCIES = ["Weekly", "Biweekly", "Monthly"];

// POST: Create a new recurring job template
export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { clientId, assignedVehicleId, notes, frequency, startDate, endDate, personnelIds, equipmentIds } =
      await request.json();

    if (!clientId || !frequency || !startDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!VALID_FREQUENCIES.includes(frequency)) {
      return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
    }

    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.recurringJobTemplate.create({
        data: {
          clientId,
          assignedVehicleId: assignedVehicleId || null,
          notes: notes || null,
          frequency,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
        },
      });

      if (Array.isArray(personnelIds) && personnelIds.length > 0) {
        await tx.recurringJobPersonnel.createMany({
          data: personnelIds.map((pId: string) => ({ templateId: created.id, personnelId: pId })),
        });
      }
      if (Array.isArray(equipmentIds) && equipmentIds.length > 0) {
        await tx.recurringJobEquipment.createMany({
          data: equipmentIds.map((eqId: string) => ({ templateId: created.id, equipmentId: eqId })),
        });
      }

      return created;
    });

    await audit(user!.userId, "CREATE", "RecurringJobTemplate", template.id, { clientId, frequency, startDate });

    return NextResponse.json(template);
  } catch (error) {
    console.error("Create Recurring Job API Error:", error);
    return NextResponse.json({ error: "Failed to create recurring job template" }, { status: 500 });
  }
}

// PUT: Update a recurring job template (fields, crew/equipment, or active toggle)
export async function PUT(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { id, clientId, assignedVehicleId, notes, frequency, startDate, endDate, active, personnelIds, equipmentIds } =
      await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing template ID" }, { status: 400 });
    }
    if (frequency !== undefined && !VALID_FREQUENCIES.includes(frequency)) {
      return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
    }

    const existing = await prisma.recurringJobTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Recurring job template not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const dataUpdate: Record<string, unknown> = {};
      if (clientId) dataUpdate.clientId = clientId;
      if (assignedVehicleId !== undefined) dataUpdate.assignedVehicleId = assignedVehicleId || null;
      if (notes !== undefined) dataUpdate.notes = notes || null;
      if (frequency) dataUpdate.frequency = frequency;
      if (startDate) dataUpdate.startDate = new Date(startDate);
      if (endDate !== undefined) dataUpdate.endDate = endDate ? new Date(endDate) : null;
      if (active !== undefined) dataUpdate.active = active;

      if (Array.isArray(personnelIds)) {
        await tx.recurringJobPersonnel.deleteMany({ where: { templateId: id } });
        if (personnelIds.length > 0) {
          await tx.recurringJobPersonnel.createMany({
            data: personnelIds.map((pId: string) => ({ templateId: id, personnelId: pId })),
          });
        }
      }
      if (Array.isArray(equipmentIds)) {
        await tx.recurringJobEquipment.deleteMany({ where: { templateId: id } });
        if (equipmentIds.length > 0) {
          await tx.recurringJobEquipment.createMany({
            data: equipmentIds.map((eqId: string) => ({ templateId: id, equipmentId: eqId })),
          });
        }
      }

      return tx.recurringJobTemplate.update({ where: { id }, data: dataUpdate });
    });

    await audit(user!.userId, "UPDATE", "RecurringJobTemplate", id, { active });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update Recurring Job API Error:", error);
    return NextResponse.json({ error: "Failed to update recurring job template" }, { status: 500 });
  }
}

// DELETE: Remove a recurring job template. Already-generated Job rows are
// kept — their recurringTemplateId is cleared (onDelete: SetNull).
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Missing template ID" }, { status: 400 });
    }

    const existing = await prisma.recurringJobTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Recurring job template not found" }, { status: 404 });
    }

    await prisma.recurringJobTemplate.delete({ where: { id } });
    await audit(user!.userId, "DELETE", "RecurringJobTemplate", id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete Recurring Job API Error:", error);
    return NextResponse.json({ error: "Failed to delete recurring job template" }, { status: 500 });
  }
}
