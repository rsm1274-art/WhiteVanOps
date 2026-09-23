import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  // A tech only ever sees their own record and jobs, whatever the query
  // string says — same authorization model as fieldOps.ts. Admin/superuser
  // may view any technician.
  const isTech = user.role === "tech";
  const requested = searchParams.get("personnelId");

  try {
    if (isTech && requested && !user.personnelId) {
      return NextResponse.json({ error: "Your account is not linked to a personnel record" }, { status: 403 });
    }
    const personnelId = requested ? (isTech ? user.personnelId! : requested) : null;

    // No personnelId = return personnel list for the technician picker
    // (a tech's list is just their own linked record)
    if (!personnelId) {
      const personnel = await prisma.personnel.findMany({
        where: isTech ? { id: user.personnelId ?? "" } : { role: "Technician" },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });
      return NextResponse.json({ personnel });
    }

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
      orderBy: [{ scheduledDate: "asc" }, { arrivalTime: { sort: "asc", nulls: "last" } }],
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
