import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";

// Read-only Plus-tier aggregates over existing data. Revenue = sum of
// JobLineItem quantity*rate on Completed jobs (labor cost is not tracked, so
// this is revenue reporting, not profitability).

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Last `n` month keys ending with the current month, oldest first. */
function lastMonths(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return keys;
}

/** TimeEntry.duration is "HH:MM" text. */
function durationToHours(duration: string): number {
  const [h, m] = duration.split(":").map((v) => parseInt(v, 10));
  if (isNaN(h)) return 0;
  return h + (isNaN(m) ? 0 : m) / 60;
}

export async function GET() {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - 11);
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);

    const [completedJobs, timeEntries, maintenanceLogs] = await Promise.all([
      prisma.job.findMany({
        where: { status: "Completed", completionDate: { gte: windowStart } },
        include: { client: true, lineItems: true },
      }),
      prisma.timeEntry.findMany({
        where: { date: { gte: windowStart } },
        include: { personnel: true },
      }),
      prisma.maintenanceLog.findMany({
        where: { date: { gte: windowStart } },
        include: { vehicle: true },
      }),
    ]);

    const months = lastMonths(12);

    // Revenue by month + top clients
    const revenueByMonthMap = new Map<string, number>(months.map((m) => [m, 0]));
    const jobsByMonthMap = new Map<string, number>(months.map((m) => [m, 0]));
    const clientRevenue = new Map<string, number>();
    let totalRevenue = 0;

    for (const job of completedJobs) {
      const jobRevenue = job.lineItems.reduce((sum, li) => sum + li.quantity * li.rate, 0);
      totalRevenue += jobRevenue;
      const key = monthKey(new Date(job.completionDate!));
      if (revenueByMonthMap.has(key)) {
        revenueByMonthMap.set(key, revenueByMonthMap.get(key)! + jobRevenue);
        jobsByMonthMap.set(key, (jobsByMonthMap.get(key) ?? 0) + 1);
      }
      clientRevenue.set(job.client.name, (clientRevenue.get(job.client.name) ?? 0) + jobRevenue);
    }

    // Technician hours (total over the window, per tech)
    const techHours = new Map<string, number>();
    let totalHours = 0;
    for (const entry of timeEntries) {
      const name = `${entry.personnel.firstName} ${entry.personnel.lastName}`;
      const hours = durationToHours(entry.duration);
      techHours.set(name, (techHours.get(name) ?? 0) + hours);
      totalHours += hours;
    }

    // Fleet maintenance cost by month
    const maintenanceByMonthMap = new Map<string, number>(months.map((m) => [m, 0]));
    let totalMaintenance = 0;
    for (const log of maintenanceLogs) {
      totalMaintenance += log.cost;
      const key = monthKey(new Date(log.date));
      if (maintenanceByMonthMap.has(key)) {
        maintenanceByMonthMap.set(key, maintenanceByMonthMap.get(key)! + log.cost);
      }
    }

    const completedCount = completedJobs.length;

    return NextResponse.json({
      windowStart: windowStart.toISOString(),
      summary: {
        totalRevenue,
        jobsCompleted: completedCount,
        avgJobValue: completedCount > 0 ? totalRevenue / completedCount : 0,
        totalLaborHours: totalHours,
        totalMaintenanceCost: totalMaintenance,
      },
      revenueByMonth: months.map((m) => ({
        month: m,
        revenue: revenueByMonthMap.get(m) ?? 0,
        jobs: jobsByMonthMap.get(m) ?? 0,
      })),
      hoursByTech: [...techHours.entries()]
        .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }))
        .sort((a, b) => b.hours - a.hours),
      maintenanceByMonth: months.map((m) => ({
        month: m,
        cost: maintenanceByMonthMap.get(m) ?? 0,
      })),
      topClients: [...clientRevenue.entries()]
        .map(([name, revenue]) => ({ name, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
    });
  } catch (error) {
    console.error("Analytics API Error:", error);
    return NextResponse.json({ error: "Failed to compute analytics" }, { status: 500 });
  }
}
