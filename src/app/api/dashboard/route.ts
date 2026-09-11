import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getLicense } from "@/lib/license";

export async function GET() {
  try {
    const license = await getLicense();

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
      invoices,
      quotes,
      syncReviewItems,
    ] = await Promise.all([
      prisma.client.findMany({
        orderBy: { name: "asc" },
        include: {
          notes: { include: { author: { select: { displayName: true } } }, orderBy: { createdAt: "desc" } },
          followUps: { include: { assignedTo: true }, orderBy: { dueDate: "asc" } },
        },
      }),
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
      prisma.invoice.findMany({
        include: {
          client: true,
          lineItems: { orderBy: { createdAt: "asc" } },
          payments: { orderBy: { receivedDate: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.quote.findMany({
        include: {
          client: true,
          lineItems: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.syncReviewItem.findMany({
        where: { status: "Open" },
        include: { personnel: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return NextResponse.json({
      license: {
        expiresAt: license.expiresAt,
      },
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
      syncReviewItems,
      invoices,
      quotes,
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
