import { prisma } from "@/lib/db";

/**
 * Shared conflict/availability validation for scheduling a job on a given date.
 * Used by job creation (POST /api/jobs), job editing (PUT /api/jobs) and
 * recurring generation so the code paths can never drift out of sync.
 *
 * `excludeJobId` lets an edit check for conflicts against every *other* job —
 * without it, a job being rescheduled would always conflict with itself.
 *
 * Two severities:
 * - `error` — the first *physical* impossibility found: an open repair, a
 *   tech on time off, or a piece of equipment already out on another job.
 *   The caller must refuse the write.
 * - `warnings` — a van or tech already booked on another job that day.
 *   Techs routinely do several short jobs a day, so this is advisory only:
 *   the caller proceeds and passes the warnings back for display.
 *   `src/lib/clientJobConflicts.ts` mirrors the same split for the modals.
 */
export interface JobConflictResult {
  error: string | null;
  warnings: string[];
}

export async function checkJobConflicts(params: {
  scheduledDate: Date;
  assignedVehicleId?: string | null;
  personnelIds?: string[];
  equipmentIds?: string[];
  excludeJobId?: string;
}): Promise<JobConflictResult> {
  const { scheduledDate, assignedVehicleId, personnelIds = [], equipmentIds = [], excludeJobId } = params;

  const startOfDay = new Date(scheduledDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(scheduledDate);
  endOfDay.setHours(23, 59, 59, 999);

  const warnings: string[] = [];
  const blocked = (error: string): JobConflictResult => ({ error, warnings });

  // 1a. Vehicle out for repair
  if (assignedVehicleId) {
    const vehicleRepair = await prisma.repairRecord.findFirst({
      where: { vehicleId: assignedVehicleId, resolvedDate: null },
    });
    if (vehicleRepair) {
      return blocked(`This vehicle is currently out of service for repair: "${vehicleRepair.description}". Resolve the repair before scheduling.`);
    }
  }

  // 1b. Vehicle double-booking (advisory)
  if (assignedVehicleId) {
    const vehicleConflictingJob = await prisma.job.findFirst({
      where: {
        assignedVehicleId,
        status: { not: "Cancelled" },
        scheduledDate: { gte: startOfDay, lte: endOfDay },
        ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      },
      include: { client: true },
    });
    if (vehicleConflictingJob) {
      warnings.push(`Vehicle is already booked on this day for job with client ${vehicleConflictingJob.client.name}.`);
    }
  }

  // 2a. Personnel time-off
  for (const personnelId of personnelIds) {
    const timeOffConflict = await prisma.personnelTimeOff.findFirst({
      where: {
        personnelId,
        startDate: { lte: endOfDay },
        endDate: { gte: startOfDay },
      },
      include: { personnel: true },
    });
    if (timeOffConflict) {
      const name = `${timeOffConflict.personnel.firstName} ${timeOffConflict.personnel.lastName}`;
      return blocked(`${name} is on ${timeOffConflict.type} leave on this date and is not available.`);
    }
  }

  // 2b. Personnel double-booking (advisory)
  for (const personnelId of personnelIds) {
    const personnelConflictingAssignment = await prisma.jobAssignment.findFirst({
      where: {
        personnelId,
        job: {
          status: { not: "Cancelled" },
          scheduledDate: { gte: startOfDay, lte: endOfDay },
          ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
        },
      },
      include: {
        job: { include: { client: true } },
        personnel: true,
      },
    });
    if (personnelConflictingAssignment) {
      const name = `${personnelConflictingAssignment.personnel.firstName} ${personnelConflictingAssignment.personnel.lastName}`;
      warnings.push(`${name} is already assigned on this day to job with client ${personnelConflictingAssignment.job.client.name}.`);
    }
  }

  // 3a. Equipment out for repair
  for (const eqId of equipmentIds) {
    const eqRepair = await prisma.repairRecord.findFirst({
      where: { equipmentId: eqId, resolvedDate: null },
      include: { equipment: true },
    });
    if (eqRepair) {
      return blocked(`${eqRepair.equipment?.name ?? "Equipment"} is currently out of service for repair: "${eqRepair.description}". Resolve the repair before scheduling.`);
    }
  }

  // 3b. Equipment double-booking
  for (const eqId of equipmentIds) {
    const conflictingEquipment = await prisma.jobEquipment.findFirst({
      where: {
        equipmentId: eqId,
        job: {
          status: { not: "Cancelled" },
          scheduledDate: { gte: startOfDay, lte: endOfDay },
          ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
        },
      },
      include: {
        job: { include: { client: true } },
        equipment: true,
      },
    });
    if (conflictingEquipment) {
      return blocked(`${conflictingEquipment.equipment.name} is already assigned on this day to job with client ${conflictingEquipment.job.client.name}.`);
    }
  }

  return { error: null, warnings };
}
