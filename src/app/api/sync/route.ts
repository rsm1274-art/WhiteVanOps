import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { jobIds, timeEntryIds } = await request.json();

    await prisma.$transaction(async (tx) => {
      if (jobIds && Array.isArray(jobIds) && jobIds.length > 0) {
        await tx.job.updateMany({
          where: { id: { in: jobIds } },
          data: { qbInvoiceSyncStatus: "Exported" },
        });
      }

      if (timeEntryIds && Array.isArray(timeEntryIds) && timeEntryIds.length > 0) {
        await tx.timeEntry.updateMany({
          where: { id: { in: timeEntryIds } },
          data: { qbTimeSyncStatus: "Exported" },
        });
      }
    });

    await audit(user!.userId, "UPDATE", "SyncStatus", "bulk", {
      jobIds: jobIds ?? [],
      timeEntryIds: timeEntryIds ?? [],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Sync Status API Error:", error);
    return NextResponse.json({ error: "Failed to update sync status" }, { status: 500 });
  }
}
