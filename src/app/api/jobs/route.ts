import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkJobConflicts } from "@/lib/jobConflicts";

// POST: Create a new job with double-booking validation for vehicles, personnel, and equipment
export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { clientId, assignedVehicleId, scheduledDate, notes, personnelIds, equipmentIds } = await request.json();

    if (!clientId || !scheduledDate || !personnelIds || !Array.isArray(personnelIds)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const targetDate = new Date(scheduledDate);

    const conflict = await checkJobConflicts({
      scheduledDate: targetDate,
      assignedVehicleId,
      personnelIds,
      equipmentIds: Array.isArray(equipmentIds) ? equipmentIds : [],
    });
    if (conflict) {
      return NextResponse.json({ error: conflict }, { status: 400 });
    }

    // Create Job and Assignments inside a transaction
    const newJob = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          clientId,
          assignedVehicleId: assignedVehicleId || null,
          status: "Scheduled",
          scheduledDate: targetDate,
          notes: notes || null,
        },
      });

      if (personnelIds.length > 0) {
        await tx.jobAssignment.createMany({
          data: personnelIds.map((pId) => ({ jobId: job.id, personnelId: pId })),
        });
      }

      if (equipmentIds && equipmentIds.length > 0) {
        await tx.jobEquipment.createMany({
          data: equipmentIds.map((eqId: string) => ({ jobId: job.id, equipmentId: eqId })),
        });
      }

      return job;
    });

    await audit(user!.userId, "CREATE", "Job", newJob.id, { clientId, scheduledDate, personnelIds });

    return NextResponse.json(newJob);
  } catch (error) {
    console.error("Create Job API Error:", error);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}

// PUT: Update job details, assign equipment/line items, or complete a job
export async function PUT(request: Request) {
  const user = await getSessionUser();
  // Techs can update job status (start/complete) but not reschedule or modify materials
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { jobId, status, clientId, assignedVehicleId, scheduledDate, notes, lineItems, equipmentIds, personnelIds } = await request.json();

    if (!jobId) {
      return NextResponse.json({ error: "Missing job ID" }, { status: 400 });
    }

    if (personnelIds !== undefined && (!Array.isArray(personnelIds) || personnelIds.length === 0)) {
      return NextResponse.json({ error: "At least one technician must be assigned." }, { status: 400 });
    }

    // Techs may only update status; block all other field changes
    if (user.role === "tech") {
      if (clientId !== undefined || assignedVehicleId !== undefined || scheduledDate !== undefined || notes !== undefined || lineItems !== undefined || equipmentIds !== undefined || personnelIds !== undefined) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Verify they are assigned to this job. A tech account not linked to a
      // Personnel record has no assignments to check against, so it must be
      // rejected outright rather than silently skipping the check.
      if (!user.personnelId) {
        return NextResponse.json({ error: "Your account is not linked to a personnel record" }, { status: 403 });
      }
      const assignment = await prisma.jobAssignment.findFirst({ where: { jobId, personnelId: user.personnelId } });
      if (!assignment) return NextResponse.json({ error: "You are not assigned to this job" }, { status: 403 });
    }

    const currentJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: { lineItems: true, assignments: true, equipment: true },
    });

    if (!currentJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // A completed job has already deducted materials from the assigned
    // vehicle's stock and been billed — client/vehicle/date are locked.
    if (currentJob.status === "Completed" && (clientId || assignedVehicleId !== undefined || scheduledDate || personnelIds !== undefined)) {
      return NextResponse.json({ error: "This job is Completed and its client, vehicle, date, and crew can no longer be edited. Reopen the job to make changes." }, { status: 400 });
    }

    // Re-run the same availability checks used at creation time whenever the
    // vehicle, date, crew, or equipment list changes on an edit — otherwise a
    // reschedule or a Resources-panel crew/equipment change could silently
    // create a double-booking that POST would have rejected.
    const effectiveVehicleId = assignedVehicleId !== undefined ? assignedVehicleId : currentJob.assignedVehicleId;
    const effectiveDate = scheduledDate ? new Date(scheduledDate) : currentJob.scheduledDate;
    const effectiveEquipmentIds = Array.isArray(equipmentIds) ? equipmentIds : currentJob.equipment.map((e) => e.equipmentId);
    const effectivePersonnelIds = Array.isArray(personnelIds) ? personnelIds : currentJob.assignments.map((a) => a.personnelId);
    if (assignedVehicleId !== undefined || scheduledDate || Array.isArray(equipmentIds) || Array.isArray(personnelIds)) {
      const conflict = await checkJobConflicts({
        scheduledDate: effectiveDate,
        assignedVehicleId: effectiveVehicleId,
        personnelIds: effectivePersonnelIds,
        equipmentIds: effectiveEquipmentIds,
        excludeJobId: jobId,
      });
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 400 });
      }
    }

    // If status is transitioning FROM Completed to something else
    if (currentJob.status === "Completed" && status && status !== "Completed") {
      const reopenedJob = await prisma.$transaction(async (tx) => {
        const updated = await tx.job.update({
          where: { id: jobId },
          data: { status, completionDate: null },
        });

        if (currentJob.assignedVehicleId) {
          const vehicleStockLocation = await tx.stockLocation.findUnique({
            where: { vehicleId: currentJob.assignedVehicleId },
          });

          if (vehicleStockLocation) {
            for (const item of currentJob.lineItems) {
              const stockLevel = await tx.stockLevel.findUnique({
                where: {
                  inventoryItemId_stockLocationId: {
                    inventoryItemId: item.inventoryItemId,
                    stockLocationId: vehicleStockLocation.id,
                  },
                },
              });

              if (stockLevel) {
                await tx.stockLevel.update({
                  where: { id: stockLevel.id },
                  data: { quantity: { increment: item.quantity } },
                });
              }
            }
          }
        }
        return updated;
      });

      await audit(user.userId, "UPDATE", "Job", jobId, { status });
      return NextResponse.json(reopenedJob);
    }

    // If status is transitioning to Completed
    if (status === "Completed" && currentJob.status !== "Completed") {
      const completedJob = await prisma.$transaction(async (tx) => {
        const updated = await tx.job.update({
          where: { id: jobId },
          data: { status: "Completed", completionDate: new Date() },
        });

        if (currentJob.assignedVehicleId) {
          const vehicleStockLocation = await tx.stockLocation.findUnique({
            where: { vehicleId: currentJob.assignedVehicleId },
          });

          if (vehicleStockLocation) {
            for (const item of currentJob.lineItems) {
              const stockLevel = await tx.stockLevel.findUnique({
                where: {
                  inventoryItemId_stockLocationId: {
                    inventoryItemId: item.inventoryItemId,
                    stockLocationId: vehicleStockLocation.id,
                  },
                },
              });

              if (stockLevel) {
                await tx.stockLevel.update({
                  where: { id: stockLevel.id },
                  data: { quantity: { decrement: item.quantity } },
                });
              } else {
                await tx.stockLevel.create({
                  data: {
                    inventoryItemId: item.inventoryItemId,
                    stockLocationId: vehicleStockLocation.id,
                    quantity: -item.quantity,
                    minThreshold: 0,
                  },
                });
              }
            }
          }
        }

        return updated;
      });

      await audit(user.userId, "UPDATE", "Job", jobId, { status: "Completed" });

      return NextResponse.json(completedJob);
    }

    const updatedJob = await prisma.$transaction(async (tx) => {
      const dataUpdate: Record<string, unknown> = {};
      if (status) dataUpdate.status = status;
      if (clientId) dataUpdate.clientId = clientId;
      if (assignedVehicleId !== undefined) dataUpdate.assignedVehicleId = assignedVehicleId || null;
      if (scheduledDate) dataUpdate.scheduledDate = new Date(scheduledDate);
      if (notes !== undefined) dataUpdate.notes = notes || null;

      if (lineItems && Array.isArray(lineItems)) {
        await tx.jobLineItem.deleteMany({ where: { jobId } });
        if (lineItems.length > 0) {
          await tx.jobLineItem.createMany({
            data: lineItems.map((li) => ({
              jobId,
              inventoryItemId: li.inventoryItemId,
              quantity: parseInt(li.quantity, 10) || 1,
              rate: parseFloat(li.rate) || 0,
              description: li.description || "",
            })),
          });
        }
      }

      if (equipmentIds && Array.isArray(equipmentIds)) {
        await tx.jobEquipment.deleteMany({ where: { jobId } });
        if (equipmentIds.length > 0) {
          await tx.jobEquipment.createMany({
            data: equipmentIds.map((eqId: string) => ({ jobId, equipmentId: eqId })),
          });
        }
      }

      if (Array.isArray(personnelIds)) {
        await tx.jobAssignment.deleteMany({ where: { jobId } });
        await tx.jobAssignment.createMany({
          data: personnelIds.map((pId: string) => ({ jobId, personnelId: pId })),
        });
      }

      return await tx.job.update({ where: { id: jobId }, data: dataUpdate });
    });

    await audit(user.userId, "UPDATE", "Job", jobId, { status, clientId, assignedVehicleId, scheduledDate, personnelIds });

    return NextResponse.json(updatedJob);
  } catch (error) {
    console.error("Update Job API Error:", error);
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}
