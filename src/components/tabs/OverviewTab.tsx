"use client";

import { DashboardData, Job } from "@/types";
import { JobStatusBadge } from "@/components/shared/StatusBadge";
import { todayLocalStr, dateToLocalStr, formatDate } from "@/lib/dateUtils";
import { getAlerts } from "@/lib/alerts";

interface Props {
  data: DashboardData;
  onOpenSyncReview: () => void;
}

export default function OverviewTab({ data, onOpenSyncReview }: Props) {
  const activeVans = data.vehicles.filter((v) => v.status === "Active").length;
  const inMaintenanceVans = data.vehicles.filter((v) => v.status === "In Maintenance").length;

  const today = todayLocalStr();
  const jobsToday = data.jobs.filter(
    (j) => dateToLocalStr(j.scheduledDate) === today && j.status !== "Cancelled"
  );

  const deployedVansToday = new Set(
    jobsToday.map((j) => j.assignedVehicleId).filter(Boolean)
  ).size;
  const deploymentRate = activeVans > 0 ? Math.round((deployedVansToday / activeVans) * 100) : 0;

  const unsyncedInvoiceCount = data.jobs.filter(
    (j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending"
  ).length;
  const unsyncedTimeCount = data.timeEntries.filter((t) => t.qbTimeSyncStatus === "Pending").length;

  const alerts = getAlerts(data);
  const lowStockCount = alerts.filter((a) => a.type === "lowStock").length;
  const overdueJobCount = alerts.filter((a) => a.type === "overdueJob").length;

  return (
    <div className="space-y-8">
      {data.syncReviewItems.length > 0 && (
        <button
          onClick={onOpenSyncReview}
          className="w-full text-left p-4 bg-amber-50 border border-amber-300 rounded flex items-center justify-between"
        >
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Field Sync Review</span>
            <p className="text-sm text-amber-800 mt-0.5">
              {data.syncReviewItems.length} record{data.syncReviewItems.length === 1 ? "" : "s"} from field techs need
              {data.syncReviewItems.length === 1 ? "s" : ""} office review.
            </p>
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Review →</span>
        </button>
      )}

      {/* KPI scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
        <Scorecard
          label="Fleet Deployment"
          value={`${deploymentRate}%`}
          sub={`${deployedVansToday} of ${activeVans} active vans dispatched today`}
        />
        <Scorecard
          label="Active Jobs Today"
          value={String(jobsToday.length)}
          sub="Pending or in progress currently"
        />
        <Scorecard
          label="Overdue Jobs"
          value={String(overdueJobCount)}
          sub="Past scheduled date, not yet completed"
          alert={overdueJobCount > 0}
        />
        <Scorecard
          label="Van Reorder Alerts"
          value={String(lowStockCount)}
          sub="Van supply counts below minimums"
          alert={lowStockCount > 0}
        />
        <Scorecard
          label="QuickBooks Backlog"
          value={String(unsyncedInvoiceCount + unsyncedTimeCount)}
          sub={`${unsyncedInvoiceCount} Invoices, ${unsyncedTimeCount} Timesheets pending`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Today's dispatch */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-800 border-b border-zinc-200 pb-3 mb-4">
            Active Dispatch Matrix (Today)
          </h3>
          {jobsToday.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">No operations currently scheduled for today.</p>
          ) : (
            <div className="space-y-3">
              {jobsToday.map((job: Job) => (
                <div
                  key={job.id}
                  className="p-4 border border-zinc-100 rounded flex items-center justify-between"
                >
                  <div>
                    <span className="text-xs font-bold uppercase text-zinc-400">
                      JOB #{job.id.substring(0, 8)}
                    </span>
                    <h4 className="text-sm font-bold mt-0.5">{job.client.name}</h4>
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-2">
                      <span>Van: {job.vehicle ? `${job.vehicle.make} ${job.vehicle.model}` : "None"}</span>
                      <span>•</span>
                      <span>
                        Tech:{" "}
                        {job.assignments.map((a) => a.personnel.firstName).join(", ") || "None"}
                      </span>
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fleet status */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-800 border-b border-zinc-200 pb-3 mb-4">
            Fleet Status Ledger
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm py-1">
              <span className="font-medium text-zinc-600">Active Service Fleet</span>
              <span className="font-bold">{activeVans} Vans</span>
            </div>
            <div className="flex items-center justify-between text-sm py-1 border-t border-zinc-100">
              <span className="font-medium text-zinc-600">Vehicles in Maintenance</span>
              <span className={`font-bold ${inMaintenanceVans > 0 ? "text-yellow-600" : ""}`}>
                {inMaintenanceVans} Vehicles
              </span>
            </div>
            {data.maintenanceLogs.length > 0 && (
              <div className="mt-4 border-t border-zinc-200 pt-4">
                <span className="text-xs font-bold uppercase text-zinc-400 block mb-2">
                  Recent Service Event
                </span>
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>
                      {data.maintenanceLogs[0].vehicle.make}{" "}
                      {data.maintenanceLogs[0].vehicle.model}
                    </span>
                    <span className="text-zinc-500">
                      {formatDate(data.maintenanceLogs[0].date)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-1">
                    {data.maintenanceLogs[0].description}
                  </p>
                  <div className="flex justify-between text-xs font-bold mt-2 pt-2 border-t border-zinc-200">
                    <span>Odometer: {data.maintenanceLogs[0].odometer.toLocaleString()} mi</span>
                    <span>Cost: ${data.maintenanceLogs[0].cost.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Scorecard({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className="p-6 bg-white border border-zinc-200 rounded flex flex-col">
      <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      <span
        className={`text-3xl font-bold tracking-tight mt-2 ${
          alert ? "text-red-600 animate-pulse" : "text-zinc-900"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-zinc-500 mt-1">{sub}</span>
    </div>
  );
}
