import { DashboardData } from "@/types";
import { dateToLocalStr, parseLocalDate } from "@/lib/dateUtils";

/**
 * Client-side mirror of src/lib/jobConflicts.ts — runs entirely against the
 * already-loaded DashboardData so the Add/Edit Job modals can show a live
 * notice as the user picks a date/vehicle/crew/equipment, before they ever
 * submit. The server (checkJobConflicts) remains the source of truth and
 * re-validates on save, so a stale notice here can never let a real
 * conflict through.
 *
 * Same split as the server: `blocking` (open repair, time off, equipment
 * already booked) will be refused on save; `advisory` (a tech or van
 * already booked that day) is allowed after a "Book anyway?" confirm.
 */
export interface ClientConflicts {
  blocking: string[];
  advisory: string[];
}

export function findClientSideConflicts(params: {
  data: DashboardData;
  scheduledDate: string; // yyyy-mm-dd, from a <input type="date">
  assignedVehicleId?: string;
  personnelIds?: string[];
  equipmentIds?: string[];
  excludeJobId?: string;
}): ClientConflicts {
  const { data, scheduledDate, assignedVehicleId, personnelIds = [], equipmentIds = [], excludeJobId } = params;
  const blocking: string[] = [];
  const advisory: string[] = [];
  if (!scheduledDate) return { blocking, advisory };

  const target = parseLocalDate(`${scheduledDate}T12:00:00`);
  const isSameDay = (jobDate: string) => dateToLocalStr(jobDate) === scheduledDate;

  const activeJobsThatDay = data.jobs.filter(
    (j) => j.status !== "Cancelled" && j.id !== excludeJobId && isSameDay(j.scheduledDate)
  );

  if (assignedVehicleId) {
    const vehicle = data.vehicles.find((v) => v.id === assignedVehicleId);
    const openRepair = vehicle?.repairRecords.find((r) => !r.resolvedDate);
    if (openRepair) {
      blocking.push(`Vehicle is currently out of service for repair: "${openRepair.description}".`);
    }
    const conflictingJob = activeJobsThatDay.find((j) => j.assignedVehicleId === assignedVehicleId);
    if (conflictingJob) {
      advisory.push(`Vehicle is already booked this day for ${conflictingJob.client.name}.`);
    }
  }

  for (const personnelId of personnelIds) {
    const person = data.personnel.find((p) => p.id === personnelId);
    const name = person ? `${person.firstName} ${person.lastName}` : "Selected technician";
    const onLeave = person?.timeOff.find(
      (t) => parseLocalDate(t.startDate) <= target && parseLocalDate(t.endDate) >= target
    );
    if (onLeave) {
      blocking.push(`${name} is on ${onLeave.type} leave this day.`);
    }
    const conflictingJob = activeJobsThatDay.find((j) => j.assignments.some((a) => a.personnelId === personnelId));
    if (conflictingJob) {
      advisory.push(`${name} is already assigned this day to ${conflictingJob.client.name}.`);
    }
  }

  for (const equipmentId of equipmentIds) {
    const eq = data.equipment.find((e) => e.id === equipmentId);
    const label = eq?.name ?? "Selected equipment";
    const openRepair = eq?.repairRecords.find((r) => !r.resolvedDate);
    if (openRepair) {
      blocking.push(`${label} is currently out of service for repair: "${openRepair.description}".`);
    }
    const conflictingJob = activeJobsThatDay.find((j) => j.equipment.some((je) => je.equipmentId === equipmentId));
    if (conflictingJob) {
      blocking.push(`${label} is already assigned this day to ${conflictingJob.client.name}.`);
    }
  }

  return { blocking, advisory };
}
