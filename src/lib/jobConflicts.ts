import { prisma } from "@/lib/db";

/**
 * Shared conflict/availability validation for scheduling a job on a given date.
 * Used by job creation (POST /api/jobs), job editing (PUT /api/jobs) and
 * recurring generation so the code paths can never drift out of sync.
 *
 * `excludeJobId` lets an edit check for conflicts against every *other* job —
 * without it, a job being rescheduled would always conflict with itself.
 *
 * Two classes of result:
 *   - `error` — a hard block. Open repairs (vehicle or equipment), time off,
 *     and equipment already booked that day: a physical tool can't be in two
 *     places at once, and a tech on leave isn't coming in.
 *   - `warnings` — advisory. A tech or van already booked that day. The
 *     business runs several short jobs per tech per day, so a same-day
 *     double-booking is normal; the caller must confirm it, not be refused.
 *
 * Blocking checks run first; if one fires, warnings are not computed.
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
  const block = (error: string): JobConflictResult => ({ error, warnings: [] });

  // --- Blocking checks ---

  // Vehicle out for repair
  if (assignedVehicleId) {
    const vehicleRepair = await prisma.repairRecord.findFirst({
      where: { vehicleId: assignedVehicleId, resolvedDate: null },
    });
    if (vehicleRepair) {
      return block(`This vehicle is currently out of service for repair: "${vehicleRepair.description}". Resolve the repair before scheduling.`);
    }
  }

  // Personnel time-off
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
      return block(`${name} is on ${timeOffConflict.type} leave on this date and is not available.`);
    }
  }

  // Equipment out for repair
  for (const eqId of equipmentIds) {
    const eqRepair = await prisma.repairRecord.findFirst({
      where: { equipmentId: eqId, resolvedDate: null },
      include: { equipment: true },
    });
    if (eqRepair) {
      return block(`${eqRepair.equipment?.name ?? "Equipment"} is currently out of service for repair: "${eqRepair.description}". Resolve the repair before scheduling.`);
    }
  }

  // Equipment double-booking
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
      return block(`${conflictingEquipment.equipment.name} is already assigned on this day to job with client ${conflictingEquipment.job.client.name}.`);
    }
  }

  // --- Advisory checks ---
  const warnings: string[] = [];

  // Vehicle double-booking
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

  // Personnel double-booking
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

  return { error: null, warnings };
}
