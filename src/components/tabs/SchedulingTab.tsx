"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { DashboardData, Job } from "@/types";
import { formatDate, todayLocalStr, dateToLocalStr } from "@/lib/dateUtils";
import { compareJobsBySchedule, formatArrivalTime } from "@/lib/jobOrder";
import { openRepair, timeOffOn } from "@/lib/clientJobConflicts";

interface Props {
  data: DashboardData;
  onScheduleJob: (date: string) => void;
  onEditJob: (job: Job) => void;
}

/** Why a resource can't take work on the selected day, or null if it can. */
type Unavailable = { label: string; tone: "red" | "yellow" } | null;

export default function SchedulingTab({ data, onScheduleJob, onEditJob }: Props) {
  const [dateFilter, setDateFilter] = useState(todayLocalStr());

  const filteredJobs = data.jobs
    .filter(
      (j) =>
        (!dateFilter || dateToLocalStr(j.scheduledDate) === dateFilter) &&
        j.status !== "Cancelled" &&
        j.status !== "Completed"
    )
    .sort(compareJobsBySchedule);

  const noVanCount = filteredJobs.filter((j) => !j.assignedVehicleId).length;

  const vehicles = data.vehicles.filter((v) => v.status !== "Retired");
  const technicians = data.personnel.filter((p) => p.role === "Technician");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Dispatch Calendar Allocation</h3>
          <p className="text-xs text-zinc-500 mt-1">
            {filteredJobs.length} open job{filteredJobs.length !== 1 ? "s" : ""}
            {dateFilter ? ` on ${formatDate(dateFilter + "T12:00:00")}` : " (all dates)"}
            {noVanCount > 0 && (
              <span className="ml-2 font-semibold text-amber-700">· {noVanCount} without a van</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Filter Date
          </label>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="p-1.5 border border-zinc-300 text-sm rounded focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          {dateFilter && (
            <button
              onClick={() => setDateFilter("")}
              className="text-xs text-zinc-500 hover:text-zinc-800 font-semibold underline"
            >
              Show All
            </button>
          )}
          <button
            onClick={() => onScheduleJob(dateFilter || todayLocalStr())}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-wide rounded inline-flex items-center gap-1.5"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule Job
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Column title="Vehicle Dispatch" empty={vehicles.length === 0 ? "No vehicles registered." : null}>
          {vehicles.map((v) => {
            const repair = openRepair(v.repairRecords);
            const unavailable: Unavailable = repair
              ? { label: "Out for repair", tone: "red" }
              : v.status === "In Maintenance"
                ? { label: "In maintenance", tone: "yellow" }
                : null;
            return (
              <ResourceRow
                key={v.id}
                caption={`VIN: ${v.vin.substring(0, 8)}...`}
                name={`${v.make} ${v.model}`}
                jobs={filteredJobs.filter((j) => j.assignedVehicleId === v.id)}
                unavailable={unavailable}
                showDates={!dateFilter}
                onEditJob={onEditJob}
              />
            );
          })}
        </Column>

        <Column title="Technician Shifts" empty={technicians.length === 0 ? "No technicians registered." : null}>
          {technicians.map((p) => {
            // Leave only makes sense against a specific day.
            const leave = dateFilter ? timeOffOn(p.timeOff, dateFilter) : undefined;
            return (
              <ResourceRow
                key={p.id}
                name={`${p.firstName} ${p.lastName}`}
                detail={p.certifications}
                jobs={filteredJobs.filter((j) => j.assignments.some((a) => a.personnelId === p.id))}
                unavailable={leave ? { label: `On leave (${leave.type})`, tone: "yellow" } : null}
                showDates={!dateFilter}
                onEditJob={onEditJob}
              />
            );
          })}
        </Column>

        <Column title="Specialized Equipment Dispatches" empty={data.equipment.length === 0 ? "No equipment registered." : null}>
          {data.equipment.map((eq) => (
            <ResourceRow
              key={eq.id}
              caption={`S/N: ${eq.serialNumber}`}
              name={eq.name}
              jobs={filteredJobs.filter((j) => j.equipment.some((je) => je.equipmentId === eq.id))}
              unavailable={openRepair(eq.repairRecords) ? { label: "Out for repair", tone: "red" } : null}
              showDates={!dateFilter}
              onEditJob={onEditJob}
            />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, empty, children }: { title: string; empty: string | null; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded p-6">
      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">{title}</h4>
      <div className="space-y-3">
        {children}
        {empty && <p className="text-xs text-zinc-400">{empty}</p>}
      </div>
    </div>
  );
}

function ResourceRow({
  caption,
  name,
  detail,
  jobs,
  unavailable,
  showDates,
  onEditJob,
}: {
  caption?: string;
  name: string;
  detail?: string | null;
  jobs: Job[];
  unavailable: Unavailable;
  showDates: boolean;
  onEditJob: (job: Job) => void;
}) {
  const toneCls =
    unavailable?.tone === "red" ? "text-red-700 bg-red-50" : "text-yellow-700 bg-yellow-50";
  return (
    <div className="p-4 border border-zinc-100 rounded flex items-start justify-between gap-3">
      <div className="min-w-0">
        {caption && <span className="text-xs font-semibold text-zinc-400 font-mono">{caption}</span>}
        <h5 className="font-bold text-sm mt-0.5">{name}</h5>
        {detail && <p className="text-xs text-zinc-500 mt-1">{detail}</p>}
        {jobs.length > 1 && (
          <p className="text-[10px] font-bold uppercase text-zinc-500 mt-1">{jobs.length} jobs</p>
        )}
      </div>
      <div className="text-right space-y-1 shrink-0">
        {unavailable && (
          <span className={`inline-block text-xs font-semibold uppercase px-2 py-1 rounded ${toneCls}`}>
            {unavailable.label}
          </span>
        )}
        {!unavailable && jobs.length === 0 && (
          <span className="inline-block text-xs text-emerald-600 font-semibold uppercase bg-emerald-50 px-2 py-1 rounded">
            Available
          </span>
        )}
        {jobs.map((j) => {
          const time = formatArrivalTime(j.arrivalTime);
          return (
            <button
              key={j.id}
              onClick={() => onEditJob(j)}
              title="Edit this job"
              className="block ml-auto text-xs bg-zinc-100 hover:bg-zinc-200 px-2 py-1 rounded font-bold text-left"
            >
              {showDates && <span className="font-medium text-zinc-500 mr-1">{formatDate(j.scheduledDate)}</span>}
              {time && <span className="font-medium text-zinc-500 mr-1">{time}</span>}
              {j.client.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
