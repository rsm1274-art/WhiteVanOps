"use client";

import { useState } from "react";
import { DashboardData } from "@/types";
import { formatDate, todayLocalStr, dateToLocalStr } from "@/lib/dateUtils";

interface Props {
  data: DashboardData;
}

export default function SchedulingTab({ data }: Props) {
  const [dateFilter, setDateFilter] = useState(todayLocalStr());

  const filteredJobs = dateFilter
    ? data.jobs.filter(
        (j) =>
          dateToLocalStr(j.scheduledDate) === dateFilter &&
          j.status !== "Cancelled" &&
          j.status !== "Completed"
      )
    : data.jobs.filter((j) => j.status !== "Cancelled" && j.status !== "Completed");

  const assignedVehicleIds = new Set(filteredJobs.map((j) => j.assignedVehicleId).filter(Boolean));
  const assignedPersonnelIds = new Set(
    filteredJobs.flatMap((j) => j.assignments.map((a) => a.personnelId))
  );
  const assignedEquipmentIds = new Set(
    filteredJobs.flatMap((j) => j.equipment.map((e) => e.equipmentId))
  );

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Dispatch Calendar Allocation</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Review vehicle allocations, tool assignments, and crew shifts to prevent conflicts.
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
            {data.vehicles.map((v) => {
              const jobs = filteredJobs.filter((j) => j.assignedVehicleId === v.id);
              const isAssigned = assignedVehicleIds.has(v.id);
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
                    {!isAssigned ? (
                      <span className="text-xs text-emerald-600 font-semibold uppercase bg-emerald-50 px-2 py-1 rounded">
                        Available
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {jobs.map((j) => (
                          <div key={j.id} className="text-xs bg-zinc-100 px-2 py-1 rounded font-bold">
                            {j.client.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {data.vehicles.length === 0 && (
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
            {data.personnel.filter((p) => p.role === "Technician").map((p) => {
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
                    {!assignedPersonnelIds.has(p.id) ? (
                      <span className="text-xs text-emerald-600 font-semibold uppercase bg-emerald-50 px-2 py-1 rounded">
                        Available
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {jobs.map((j) => (
                          <div key={j.id} className="text-xs bg-zinc-100 px-2 py-1 rounded font-bold">
                            {j.client.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {data.personnel.filter((p) => p.role === "Technician").length === 0 && (
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
                    {!assignedEquipmentIds.has(eq.id) ? (
                      <span className="text-xs text-emerald-600 font-semibold uppercase bg-emerald-50 px-2 py-1 rounded">
                        Available
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {jobs.map((j) => (
                          <div key={j.id} className="text-xs bg-zinc-100 px-2 py-1 rounded font-bold">
                            {j.client.name}
                          </div>
                        ))}
                      </div>
                    )}
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
