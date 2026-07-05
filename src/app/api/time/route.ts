import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admins and superusers can log time for anyone; techs can only log for themselves
  if (user.role === "tech") {
    const err = requireRole(user, "tech", "admin", "superuser");
    if (err) return err;
  }

  try {
    const { jobId, personnelId, date, duration, serviceItem, payrollItem } = await request.json();

    if (!jobId || !personnelId || !date || !duration) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Tech users can only log time for their own linked personnelId
    if (user.role === "tech") {
      if (!user.personnelId || personnelId !== user.personnelId) {
        return NextResponse.json({ error: "You can only log time for yourself" }, { status: 403 });
      }
      // Verify they are assigned to this job
      const assignment = await prisma.jobAssignment.findFirst({
        where: { jobId, personnelId },
      });
      if (!assignment) {
        return NextResponse.json({ error: "You are not assigned to this job" }, { status: 403 });
      }
    }

    const durationRegex = /^\d{2}:\d{2}$/;
    if (!durationRegex.test(duration)) {
      return NextResponse.json(
        { error: "Duration must be in strict [HH:MM] format (e.g., '08:30' or '00:45')" },
        { status: 400 }
      );
    }

    const newEntry = await prisma.timeEntry.create({
      data: {
        jobId,
        personnelId,
        date: new Date(date),
        duration,
        serviceItem: serviceItem || "Field Labor",
        payrollItem: payrollItem || "Regular Pay",
        qbTimeSyncStatus: "Pending",
      },
    });

    await audit(user.userId, "CREATE", "TimeEntry", newEntry.id, { jobId, personnelId, date, duration });

    return NextResponse.json(newEntry);
  } catch (error) {
    console.error("Time Entry API Error:", error);
    return NextResponse.json({ error: "Failed to create time entry" }, { status: 500 });
  }
}
