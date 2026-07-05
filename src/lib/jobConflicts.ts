import { prisma } from "@/lib/db";

/**
 * Shared conflict/availability validation for scheduling a job on a given date.
 * Used by both job creation (POST /api/jobs) and job editing (PUT /api/jobs)
 * so the two code paths can never drift out of sync.
 *
 * `excludeJobId` lets an edit check for conflicts against every *other* job —
 * without it, a job being rescheduled would always conflict with itself.
 *
 * Returns a human-readable error string on the first conflict found, or null
 * if the requested date/resources are clear.
 */
export async function checkJobConflicts(params: {
  scheduledDate: Date;
  assignedVehicleId?: string | null;
  personnelIds?: string[];
  equipmentIds?: string[];
  excludeJobId?: string;
}): Promise<string | null> {
  const { scheduledDate, assignedVehicleId, personnelIds = [], equipmentIds = [], excludeJobId } = params;

  const startOfDay = new Date(scheduledDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(scheduledDate);
  endOfDay.setHours(23, 59, 59, 999);

  // 1a. Vehicle out for repair
  if (assignedVehicleId) {
    const vehicleRepair = await prisma.repairRecord.findFirst({
      where: { vehicleId: assignedVehicleId, resolvedDate: null },
    });
    if (vehicleRepair) {
      return `This vehicle is currently out of service for repair: "${vehicleRepair.description}". Resolve the repair before scheduling.`;
    }
  }

  // 1b. Vehicle double-booking
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
      return `Vehicle is already booked on this day for job with client ${vehicleConflictingJob.client.name}.`;
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
      return `${name} is on ${timeOffConflict.type} leave on this date and is not available.`;
    }
  }

  // 2b. Personnel double-booking
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
      return `${name} is already assigned on this day to job with client ${personnelConflictingAssignment.job.client.name}.`;
    }
  }

  // 3a. Equipment out for repair
  for (const eqId of equipmentIds) {
    const eqRepair = await prisma.repairRecord.findFirst({
      where: { equipmentId: eqId, resolvedDate: null },
      include: { equipment: true },
    });
    if (eqRepair) {
      return `${eqRepair.equipment?.name ?? "Equipment"} is currently out of service for repair: "${eqRepair.description}". Resolve the repair before scheduling.`;
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
      return `${conflictingEquipment.equipment.name} is already assigned on this day to job with client ${conflictingEquipment.job.client.name}.`;
    }
  }

  return null;
}
