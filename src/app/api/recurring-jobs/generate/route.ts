import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkJobConflicts } from "@/lib/jobConflicts";
import { nextOccurrence, RecurrenceFrequency } from "@/lib/recurrence";

// Bounded batch size: generation is a manual, admin-triggered action (this
// app has no background scheduler), so each click produces a fixed, small
// batch the admin can review rather than trying to backfill "everything due."
const BATCH_SIZE = 4;

// POST: Generate the next batch of Job rows from a recurring template.
// Conflicting occurrences (double-booking, open repair, time-off) are
// skipped individually and reported back — never silently dropped, never
// blocking the rest of the batch.
export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { templateId } = await request.json();
    if (!templateId) {
      return NextResponse.json({ error: "Missing template ID" }, { status: 400 });
    }

    const template = await prisma.recurringJobTemplate.findUnique({
      where: { id: templateId },
      include: { personnel: true, equipment: true },
    });
    if (!template) {
      return NextResponse.json({ error: "Recurring job template not found" }, { status: 404 });
    }
    if (!template.active) {
      return NextResponse.json({ error: "This recurring job is paused. Reactivate it before generating jobs." }, { status: 400 });
    }

    const personnelIds = template.personnel.map((p: { personnelId: string }) => p.personnelId);
    const equipmentIds = template.equipment.map((e: { equipmentId: string }) => e.equipmentId);
    const frequency = template.frequency as RecurrenceFrequency;

    let cursor = template.lastGeneratedDate
      ? nextOccurrence(template.lastGeneratedDate, frequency)
      : template.startDate;

    const created: string[] = [];
    const skipped: { date: string; reason: string }[] = [];
    let lastAttempted: Date | null = null;

    for (let i = 0; i < BATCH_SIZE; i++) {
      if (template.endDate && cursor > template.endDate) break;

      lastAttempted = cursor;
      const occurrenceDate = cursor;

      const conflict = await checkJobConflicts({
        scheduledDate: occurrenceDate,
        assignedVehicleId: template.assignedVehicleId,
        personnelIds,
        equipmentIds,
      });

      if (conflict) {
        skipped.push({ date: occurrenceDate.toISOString(), reason: conflict });
      } else {
        await prisma.$transaction(async (tx) => {
          const job = await tx.job.create({
            data: {
              clientId: template.clientId,
              assignedVehicleId: template.assignedVehicleId,
              status: "Scheduled",
              scheduledDate: occurrenceDate,
              notes: template.notes,
              recurringTemplateId: template.id,
            },
          });
          if (personnelIds.length > 0) {
            await tx.jobAssignment.createMany({
              data: personnelIds.map((pId: string) => ({ jobId: job.id, personnelId: pId })),
            });
          }
          if (equipmentIds.length > 0) {
            await tx.jobEquipment.createMany({
              data: equipmentIds.map((eqId: string) => ({ jobId: job.id, equipmentId: eqId })),
            });
          }
        });
        created.push(occurrenceDate.toISOString());
      }

      cursor = nextOccurrence(cursor, frequency);
    }

    if (lastAttempted) {
      await prisma.recurringJobTemplate.update({
        where: { id: templateId },
        data: { lastGeneratedDate: lastAttempted },
      });
    }

    await audit(user!.userId, "CREATE", "RecurringJobTemplate", templateId, {
      action: "generate",
      createdCount: created.length,
      skippedCount: skipped.length,
    });

    return NextResponse.json({ created, skipped });
  } catch (error) {
    console.error("Generate Recurring Jobs API Error:", error);
    return NextResponse.json({ error: "Failed to generate jobs" }, { status: 500 });
  }
}
