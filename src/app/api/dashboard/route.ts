import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [
      clients,
      personnel,
      vehicles,
      equipment,
      stockLocations,
      inventoryItems,
      jobs,
      timeEntries,
      maintenanceLogs,
      recurringJobTemplates,
    ] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: "asc" } }),
      prisma.personnel.findMany({
        include: {
          qualifications: { orderBy: { category: "asc" } },
          timeOff: { orderBy: { startDate: "asc" } },
        },
        orderBy: { lastName: "asc" },
      }),
      prisma.vehicle.findMany({
        include: { repairRecords: { where: { resolvedDate: null }, take: 1, orderBy: { createdAt: "desc" } } },
        orderBy: { make: "asc" },
      }),
      prisma.equipment.findMany({
        include: { repairRecords: { where: { resolvedDate: null }, take: 1, orderBy: { createdAt: "desc" } } },
        orderBy: { name: "asc" },
      }),
      prisma.stockLocation.findMany({
        include: {
          stockLevels: {
            include: {
              inventoryItem: true,
            },
          },
          vehicle: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.inventoryItem.findMany({ orderBy: { name: "asc" } }),
      prisma.job.findMany({
        include: {
          client: true,
          vehicle: true,
          assignments: {
            include: {
              personnel: true,
            },
          },
          equipment: {
            include: {
              equipment: true,
            },
          },
          lineItems: {
            include: {
              inventoryItem: true,
            },
          },
        },
        orderBy: { scheduledDate: "desc" },
      }),
      prisma.timeEntry.findMany({
        include: {
          job: {
            include: {
              client: true,
            },
          },
          personnel: true,
        },
        orderBy: { date: "desc" },
      }),
      prisma.maintenanceLog.findMany({
        include: {
          vehicle: true,
        },
        orderBy: { date: "desc" },
      }),
      prisma.recurringJobTemplate.findMany({
        include: {
          client: true,
          vehicle: true,
          personnel: { include: { personnel: true } },
          equipment: { include: { equipment: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      clients,
      personnel,
      vehicles,
      equipment,
      stockLocations,
      inventoryItems,
      jobs,
      timeEntries,
      maintenanceLogs,
      recurringJobTemplates,
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
