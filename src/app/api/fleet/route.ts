import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { action, ...payload } = await request.json();

    if (action === "create_vehicle") {
      const { vin, make, model, status } = payload;

      if (!vin || !make || !model || !status) {
        return NextResponse.json({ error: "Missing required vehicle fields" }, { status: 400 });
      }

      const existing = await prisma.vehicle.findUnique({ where: { vin } });
      if (existing) {
        return NextResponse.json({ error: "A vehicle with this VIN already exists" }, { status: 400 });
      }

      const newVehicle = await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.create({ data: { vin, make, model, status } });

        await tx.stockLocation.create({
          data: {
            name: `Van ${model} (${vin.substring(0, 4)}) Stock`,
            type: "Vehicle",
            vehicleId: vehicle.id,
          },
        });

        return vehicle;
      });

      await audit(user!.userId, "CREATE", "Vehicle", newVehicle.id, { vin, make, model });

      return NextResponse.json(newVehicle);
    }

    if (action === "add_maintenance") {
      const { vehicleId, date, cost, description, odometer } = payload;

      if (!vehicleId || !date || !cost || !description || !odometer) {
        return NextResponse.json({ error: "Missing required maintenance fields" }, { status: 400 });
      }

      const log = await prisma.maintenanceLog.create({
        data: {
          vehicleId,
          date: new Date(date),
          cost: parseFloat(cost) || 0,
          description,
          odometer: parseInt(odometer, 10) || 0,
        },
      });

      await audit(user!.userId, "CREATE", "MaintenanceLog", log.id, { vehicleId, description });

      return NextResponse.json(log);
    }

    if (action === "create_repair") {
      const { assetId, assetType, description, repairType, location, serviceProvider, servicePhone, ticketNumber, startDate, notes } = payload;
      if (!assetId || !assetType || !description || !repairType || !startDate) {
        return NextResponse.json({ error: "Missing required repair fields" }, { status: 400 });
      }

      const record = await prisma.$transaction(async (tx) => {
        const repair = await tx.repairRecord.create({
          data: {
            ...(assetType === "vehicle" ? { vehicleId: assetId } : { equipmentId: assetId }),
            description,
            repairType,
            location: location?.trim() || null,
            serviceProvider: serviceProvider?.trim() || null,
            servicePhone: servicePhone?.trim() || null,
            ticketNumber: ticketNumber?.trim() || null,
            startDate: new Date(startDate),
            notes: notes?.trim() || null,
          },
        });

        if (assetType === "vehicle") {
          await tx.vehicle.update({ where: { id: assetId }, data: { status: "In Maintenance" } });
        } else {
          await tx.equipment.update({ where: { id: assetId }, data: { status: "Maintenance" } });
        }

        return repair;
      });

      await audit(user!.userId, "CREATE", "RepairRecord", record.id, { assetId, assetType, description });

      return NextResponse.json(record);
    }

    if (action === "resolve_repair") {
      const { repairId, assetId, assetType } = payload;
      if (!repairId || !assetId || !assetType) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.repairRecord.update({ where: { id: repairId }, data: { resolvedDate: new Date() } });

        if (assetType === "vehicle") {
          await tx.vehicle.update({ where: { id: assetId }, data: { status: "Active" } });
        } else {
          await tx.equipment.update({ where: { id: assetId }, data: { status: "Active" } });
        }
      });

      await audit(user!.userId, "UPDATE", "RepairRecord", repairId, { resolved: true, assetId, assetType });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Fleet API Error:", error);
    return NextResponse.json({ error: "Failed to execute fleet action" }, { status: 500 });
  }
}
