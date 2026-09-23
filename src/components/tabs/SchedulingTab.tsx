"use client";

import { useState } from "react";
import { DashboardData, Job } from "@/types";
import { formatDate, todayLocalStr, dateToLocalStr, parseLocalDate } from "@/lib/dateUtils";
import { arrivalLabel, compareByDayThenArrival } from "@/lib/arrival";

interface Props {
  data: DashboardData;
  onScheduleJob: (date: string) => void;
  onEditJob: (job: Job) => void;
}

/** Right-hand status cell: job chips when booked, else an out-of-service/leave label, else Available. */
function StatusCell({
  jobs,
  unavailable,
  onEditJob,
}: {
  jobs: Job[];
  unavailable: string | null;
  onEditJob: (job: Job) => void;
}) {
  if (jobs.length === 0) {
    return unavailable ? (
      <span className="text-xs text-red-700 font-semibold uppercase bg-red-50 px-2 py-1 rounded">{unavailable}</span>
    ) : (
      <span className="text-xs text-emerald-600 font-semibold uppercase bg-emerald-50 px-2 py-1 rounded">Available</span>
    );
  }
  return (
    <div className="space-y-1">
      {unavailable && (
        <div className="text-[10px] text-red-700 font-semibold uppercase">{unavailable}</div>
      )}
      {jobs.map((j) => {
        const when = arrivalLabel(j);
        return (
          <button
            key={j.id}
            type="button"
            onClick={() => onEditJob(j)}
            title="Edit job"
            className="block w-full text-right text-xs bg-zinc-100 hover:bg-zinc-200 px-2 py-1 rounded font-bold"
          >
            {when && <span className="block font-mono font-medium text-[10px] text-zinc-500 whitespace-nowrap">{when}</span>}
            {j.client.name}
          </button>
        );
      })}
    </div>
  );
}

export default function SchedulingTab({ data, onScheduleJob, onEditJob }: Props) {
  const [dateFilter, setDateFilter] = useState(todayLocalStr());

  const filteredJobs = data.jobs
    .filter(
      (j) =>
        (!dateFilter || dateToLocalStr(j.scheduledDate) === dateFilter) &&
        j.status !== "Cancelled" &&
        j.status !== "Completed"
    )
    .sort(compareByDayThenArrival<Job>(dateToLocalStr));

  const noVanCount = filteredJobs.filter((j) => !j.assignedVehicleId).length;

  // Leave is date-specific, so it only applies when a single day is selected.
  const target = dateFilter ? parseLocalDate(`${dateFilter}T12:00:00`) : null;
  const leaveFor = (personnelId: string): string | null => {
    if (!target) return null;
    const person = data.personnel.find((p) => p.id === personnelId);
    const off = person?.timeOff.find(
      (t) => parseLocalDate(t.startDate) <= target && parseLocalDate(t.endDate) >= target
    );
    return off ? `On leave (${off.type})` : null;
  };

  const vehicles = data.vehicles.filter((v) => v.status !== "Retired");
  const technicians = data.personnel.filter((p) => p.role === "Technician");

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Dispatch Calendar Allocation</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Review vehicle allocations, tool assignments, and crew shifts to prevent conflicts.
          </p>
          <p className="text-xs text-zinc-600 mt-2 font-semibold">
            {filteredJobs.length} open job{filteredJobs.length !== 1 ? "s" : ""}
            {noVanCount > 0 && (
              <span className="text-amber-700"> · {noVanCount} with no van</span>
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
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs uppercase tracking-wider font-bold rounded transition-colors"
          >
            + Schedule Job
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Vehicle Allocation */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Vehicle Dispatch
            {dateFilter && (
              <span className="ml-2 text-zinc-300 normal-case font-medium">
                — {formatDate(dateFilter + "T12:00:00")}
              </span>
            )}
          </h4>
          <div className="space-y-3">
            {vehicles.map((v) => {
              const jobs = filteredJobs.filter((j) => j.assignedVehicleId === v.id);
              const outOfService = v.status === "In Maintenance" || v.repairRecords.some((r) => !r.resolvedDate);
              return (
                <div key={v.id} className="p-4 border border-zinc-100 rounded flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-400 font-mono">
                      VIN: {v.vin.substring(0, 8)}...
                    </span>
                    <h5 className="font-bold text-sm mt-0.5">{v.make} {v.model}</h5>
                    <span className={`text-[10px] uppercase font-bold ${v.status === "Active" ? "text-emerald-600" : "text-yellow-600"}`}>
                      {v.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <StatusCell jobs={jobs} unavailable={outOfService ? "Out of service" : null} onEditJob={onEditJob} />
                  </div>
                </div>
              );
            })}
            {vehicles.length === 0 && (
              <p className="text-xs text-zinc-400">No vehicles registered.</p>
            )}
          </div>
        </div>

        {/* Technician Shifts */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Technician Shifts
          </h4>
          <div className="space-y-3">
            {technicians.map((p) => {
              const jobs = filteredJobs.filter((j) =>
                j.assignments.some((a) => a.personnelId === p.id)
              );
              return (
                <div key={p.id} className="p-4 border border-zinc-100 rounded flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-sm">{p.firstName} {p.lastName}</h5>
                    {p.certifications && (
                      <p className="text-xs text-zinc-500 mt-1">{p.certifications}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <StatusCell jobs={jobs} unavailable={leaveFor(p.id)} onEditJob={onEditJob} />
                  </div>
                </div>
              );
            })}
            {technicians.length === 0 && (
              <p className="text-xs text-zinc-400">No technicians registered.</p>
            )}
          </div>
        </div>

        {/* Equipment Dispatches */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Specialized Equipment Dispatches
          </h4>
          <div className="space-y-3">
            {data.equipment.map((eq) => {
              const jobs = filteredJobs.filter((j) =>
                j.equipment.some((je) => je.equipmentId === eq.id)
              );
              const outOfService = eq.status === "Maintenance" || eq.repairRecords.some((r) => !r.resolvedDate);
              return (
                <div key={eq.id} className="p-4 border border-zinc-100 rounded flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-400 font-mono">
                      S/N: {eq.serialNumber}
                    </span>
                    <h5 className="font-bold text-sm mt-0.5">{eq.name}</h5>
                    <span className={`text-[10px] uppercase font-bold ${eq.status === "Active" ? "text-emerald-600" : "text-yellow-600"}`}>
                      {eq.status}
                    </span>
                  </div>
                  <div className="text-right">
                    <StatusCell jobs={jobs} unavailable={outOfService ? "Out of service" : null} onEditJob={onEditJob} />
                  </div>
                </div>
              );
            })}
            {data.equipment.length === 0 && (
              <p className="text-xs text-zinc-400">No equipment registered.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
