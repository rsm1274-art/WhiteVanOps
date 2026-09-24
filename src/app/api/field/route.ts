import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { trialExpiredResponse } from "@/lib/trialGuard";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expired = trialExpiredResponse();
  if (expired) return expired;

  const { searchParams } = new URL(request.url);
  const requestedId = searchParams.get("personnelId");

  // A tech only ever sees their own record and jobs — the query parameter is
  // ignored for them, so changing it can't expose another tech's schedule.
  // Admin/superuser keep the picker and can view any tech (same split as
  // fieldOps.ts's assignment check).
  const isTech = user.role === "tech";
  if (isTech && !user.personnelId) {
    return NextResponse.json({ error: "Your account is not linked to a personnel record" }, { status: 403 });
  }

  try {
    // No personnelId = return personnel list for the technician picker
    if (!requestedId) {
      const personnel = await prisma.personnel.findMany({
        where: isTech ? { id: user.personnelId! } : { role: "Technician" },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });
      return NextResponse.json({ personnel });
    }

    const personnelId = isTech ? user.personnelId! : requestedId;

    // Return all non-cancelled jobs assigned to this technician
    const jobs = await prisma.job.findMany({
      where: {
        status: { not: "Cancelled" },
        assignments: { some: { personnelId } },
      },
      include: {
        client: true,
        vehicle: true,
        assignments: { include: { personnel: true } },
        lineItems: { include: { inventoryItem: true } },
        equipment: { include: { equipment: true } },
        timeEntries: {
          where: { personnelId },
          orderBy: { date: "desc" },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { arrivalTime: "asc" }],
    });

    const inventoryItems = await prisma.inventoryItem.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ jobs, inventoryItems });
  } catch (error) {
    console.error("Field API Error:", error);
    return NextResponse.json({ error: "Failed to load field data" }, { status: 500 });
  }
}
