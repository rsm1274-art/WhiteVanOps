import { DashboardData } from "@/types";
import { todayLocalStr, dateToLocalStr, formatDate } from "@/lib/dateUtils";

export interface AppAlert {
  id: string;
  type: "lowStock" | "overdueJob" | "followUpDue";
  title: string;
  detail: string;
}

/**
 * Single source of truth for what counts as a low-stock or overdue-job
 * alert, so the notification bell, the Overview scorecard, and any future
 * consumer never drift out of sync on the definition.
 */
export function getAlerts(data: DashboardData): AppAlert[] {
  const today = todayLocalStr();
  const alerts: AppAlert[] = [];

  // Overdue jobs: still Scheduled or In Progress, but the scheduled date
  // has already passed.
  data.jobs
    .filter(
      (j) =>
        (j.status === "Scheduled" || j.status === "In Progress") &&
        dateToLocalStr(j.scheduledDate) < today
    )
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
    .forEach((j) => {
      alerts.push({
        id: `job-${j.id}`,
        type: "overdueJob",
        title: j.client.name,
        detail: `${j.status} — was scheduled ${formatDate(j.scheduledDate)}`,
      });
    });

  // Low stock: any stock level at or below its minimum threshold.
  data.stockLocations.forEach((loc) => {
    loc.stockLevels
      .filter((lvl) => lvl.quantity <= lvl.minThreshold)
      .forEach((lvl) => {
        alerts.push({
          id: `stock-${lvl.id}`,
          type: "lowStock",
          title: lvl.inventoryItem.name,
          detail: `${loc.name}: ${lvl.quantity} on hand (min ${lvl.minThreshold})`,
        });
      });
  });

  // Due/overdue client follow-ups (Plus tier — followUps is only present in
  // the dashboard payload when licensed).
  data.clients.forEach((c) => {
    (c.followUps ?? [])
      .filter((f) => !f.completed && dateToLocalStr(f.dueDate) <= today)
      .forEach((f) => {
        alerts.push({
          id: `followup-${f.id}`,
          type: "followUpDue",
          title: c.name,
          detail: `Follow-up due ${formatDate(f.dueDate)} — ${f.note}`,
        });
      });
  });

  return alerts;
}
