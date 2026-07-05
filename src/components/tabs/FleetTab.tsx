"use client";

import { Plus, Wrench, MapPin, Phone, Hash, CheckCircle } from "lucide-react";
import { DashboardData, RepairContext, Vehicle } from "@/types";
import { formatDate } from "@/lib/dateUtils";

interface Props {
  data: DashboardData;
  onAddVehicle: () => void;
  onAddEquipment: () => void;
  onAddMaintenance: (vehicle: Vehicle) => void;
  onReportRepair: (ctx: RepairContext) => void;
  onResolveRepair: (repairId: string, assetId: string, assetType: "vehicle" | "equipment", assetName: string) => void;
}

function RepairBadge({ repair }: { repair: NonNullable<DashboardData["vehicles"][0]["repairRecords"][0]> }) {
  return (
    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Wrench className="h-3 w-3 text-red-500 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-red-700">
          {repair.repairType} Repair
        </span>
        <span className="text-[10px] text-red-500 ml-auto">Since {formatDate(repair.startDate)}</span>
      </div>
      <p className="text-xs text-red-800 font-medium">{repair.description}</p>
      {repair.repairType === "Off-Site" && (
        <div className="space-y-0.5 border-t border-red-100 pt-1.5">
          {repair.location && (
            <div className="flex items-start gap-1 text-[10px] text-red-700">
              <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
              <span>{repair.location}</span>
            </div>
          )}
          {repair.serviceProvider && (
            <div className="flex items-start gap-1 text-[10px] text-red-700">
              <span className="font-semibold">Contact:</span>
              <span>{repair.serviceProvider}</span>
            </div>
          )}
          {repair.servicePhone && (
            <div className="flex items-center gap-1 text-[10px] text-red-700">
              <Phone className="h-3 w-3 shrink-0" />
              <span>{repair.servicePhone}</span>
            </div>
          )}
          {repair.ticketNumber && (
            <div className="flex items-center gap-1 text-[10px] text-red-700">
              <Hash className="h-3 w-3 shrink-0" />
              <span>{repair.ticketNumber}</span>
            </div>
          )}
        </div>
      )}
      {repair.notes && <p className="text-[10px] text-red-500 italic">{repair.notes}</p>}
    </div>
  );
}

export default function FleetTab({
  data,
  onAddVehicle,
  onAddEquipment,
  onAddMaintenance,
  onReportRepair,
  onResolveRepair,
}: Props) {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Fleet Vehicles & Maintenance</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Audit fleet health, VIN logs, mileage counters, and tool registries.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAddEquipment}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Equipment
          </button>
          <button
            onClick={onAddVehicle}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Vehicle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Vehicle list */}
        <div className="lg:col-span-1 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Fleet Vehicles</h4>
          {data.vehicles.length === 0 ? (
            <p className="text-xs text-zinc-400">No vehicles registered yet.</p>
          ) : (
            data.vehicles.map((v) => {
              const repair = v.repairRecords[0] ?? null;
              const isOut = !!repair;
              return (
                <div key={v.id} className={`p-4 border rounded flex flex-col gap-3 ${isOut ? "bg-red-50 border-red-200" : "bg-zinc-50 border-zinc-200"}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h5 className="font-bold text-sm">{v.make} {v.model}</h5>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mt-0.5">
                        VIN: {v.vin}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded ${
                      v.status === "Active" ? "bg-emerald-50 text-emerald-700" :
                      v.status === "In Maintenance" ? "bg-red-100 text-red-700" :
                      "bg-zinc-100 text-zinc-700"
                    }`}>
                      {v.status}
                    </span>
                  </div>

                  {repair && <RepairBadge repair={repair} />}

                  <div className="flex gap-2 pt-1 border-t border-zinc-100">
                    {isOut ? (
                      <button
                        onClick={() => onResolveRepair(repair.id, v.id, "vehicle", `${v.make} ${v.model}`)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold uppercase tracking-wide rounded transition-colors"
                      >
                        <CheckCircle className="h-3 w-3" />
                        Mark Resolved
                      </button>
                    ) : (
                      <button
                        onClick={() => onReportRepair({ assetId: v.id, assetType: "vehicle", assetName: `${v.make} ${v.model}` })}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] border border-red-200 text-red-600 hover:bg-red-50 font-bold uppercase tracking-wide rounded transition-colors"
                      >
                        <Wrench className="h-3 w-3" />
                        Report Repair
                      </button>
                    )}
                    <button
                      onClick={() => onAddMaintenance(v)}
                      className="ml-auto px-2 py-1 text-[10px] border border-zinc-300 hover:bg-zinc-100 font-bold uppercase tracking-wide rounded transition-colors"
                    >
                      + Service Log
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Maintenance history */}
          <div className="bg-white border border-zinc-200 rounded p-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
              Maintenance Service History
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <th className="py-2 px-4">Vehicle</th>
                    <th className="py-2 px-4">Date</th>
                    <th className="py-2 px-4">Description</th>
                    <th className="py-2 px-4">Odometer</th>
                    <th className="py-2 px-4 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 text-xs">
                  {data.maintenanceLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-4 text-center text-zinc-500">
                        No maintenance records logged.
                      </td>
                    </tr>
                  ) : (
                    data.maintenanceLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-zinc-50">
                        <td className="py-3 px-4 font-semibold">{log.vehicle.make} {log.vehicle.model}</td>
                        <td className="py-3 px-4">{formatDate(log.date)}</td>
                        <td className="py-3 px-4 text-zinc-600 max-w-xs truncate">{log.description}</td>
                        <td className="py-3 px-4 font-mono">{log.odometer.toLocaleString()} mi</td>
                        <td className="py-3 px-4 text-right font-bold text-zinc-700">${log.cost.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Equipment registry */}
          <div className="bg-white border border-zinc-200 rounded p-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
              Specialized Tool Registry
            </h4>
            <div className="space-y-2">
              {data.equipment.length === 0 ? (
                <p className="text-xs text-zinc-400 py-4 text-center">No specialized equipment tools registered yet.</p>
              ) : (
                data.equipment.map((eq) => {
                  const repair = eq.repairRecords[0] ?? null;
                  const isOut = !!repair;
                  return (
                    <div key={eq.id} className={`flex flex-col gap-2 p-3 border rounded ${isOut ? "bg-red-50 border-red-200" : "border-zinc-100 bg-zinc-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-semibold text-sm text-zinc-900">{eq.name}</span>
                          <span className="text-[10px] font-mono text-zinc-400 block">S/N: {eq.serialNumber}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                            eq.status === "Active" ? "bg-emerald-50 text-emerald-700" :
                            eq.status === "In Use" ? "bg-blue-50 text-blue-700" :
                            "bg-red-100 text-red-700"
                          }`}>
                            {eq.status}
                          </span>
                          {isOut ? (
                            <button
                              onClick={() => onResolveRepair(repair.id, eq.id, "equipment", eq.name)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold uppercase tracking-wide rounded transition-colors"
                            >
                              <CheckCircle className="h-3 w-3" />
                              Resolve
                            </button>
                          ) : (
                            <button
                              onClick={() => onReportRepair({ assetId: eq.id, assetType: "equipment", assetName: eq.name })}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] border border-red-200 text-red-600 hover:bg-red-50 font-bold uppercase tracking-wide rounded transition-colors"
                            >
                              <Wrench className="h-3 w-3" />
                              Report
                            </button>
                          )}
                        </div>
                      </div>
                      {repair && <RepairBadge repair={repair} />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
