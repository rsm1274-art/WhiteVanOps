import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const personnelId = searchParams.get("personnelId");

  try {
    // No personnelId = return personnel list for the technician picker
    if (!personnelId) {
      const personnel = await prisma.personnel.findMany({
        where: { role: "Technician" },
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
      orderBy: { scheduledDate: "asc" },
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
