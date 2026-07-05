"use client";

import { useState } from "react";
import { Plus, Search, CalendarOff, Edit2 } from "lucide-react";
import { DashboardData, Personnel } from "@/types";
import { SyncStatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/dateUtils";

const CATEGORY_COLORS: Record<string, string> = {
  Certification: "bg-blue-100 text-blue-800",
  License: "bg-purple-100 text-purple-800",
  Skill: "bg-emerald-100 text-emerald-800",
  Other: "bg-zinc-100 text-zinc-700",
};

const TIMEOFF_COLORS: Record<string, string> = {
  Vacation: "bg-sky-100 text-sky-800",
  Sick: "bg-red-100 text-red-800",
  Personal: "bg-amber-100 text-amber-800",
  Other: "bg-zinc-100 text-zinc-700",
};

function upcomingTimeOff(p: Personnel) {
  const today = new Date();
  return p.timeOff.filter((t) => new Date(t.endDate) >= today);
}

function matchesSearch(p: Personnel, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (`${p.firstName} ${p.lastName}`.toLowerCase().includes(q)) return true;
  if (p.role.toLowerCase().includes(q)) return true;
  return p.qualifications.some(
    (qual) =>
      qual.tag.toLowerCase().includes(q) ||
      qual.category.toLowerCase().includes(q) ||
      (qual.issuedBy ?? "").toLowerCase().includes(q)
  );
}

interface Props {
  data: DashboardData;
  onAddPersonnel: () => void;
  onLogTime: () => void;
  onEditPersonnel: (p: Personnel) => void;
}

export default function PersonnelTab({ data, onAddPersonnel, onLogTime, onEditPersonnel }: Props) {
  const [search, setSearch] = useState("");

  const filtered = data.personnel.filter((p) => matchesSearch(p, search));

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Technician Rosters & Timesheets</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Manage qualifications, licenses, time off, and crew hours.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAddPersonnel}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Employee
          </button>
          <button
            onClick={onLogTime}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Log Labor Hours
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Roster */}
        <div className="lg:col-span-1 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by name, certification, license…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-zinc-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>

          {search && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
            </p>
          )}

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center">
                {search ? `No matches for "${search}"` : "No crew members registered yet."}
              </p>
            ) : (
              filtered.map((p) => {
                const upcoming = upcomingTimeOff(p);
                return (
                  <div key={p.id} className="bg-white p-4 border border-zinc-200 rounded space-y-3">
                    {/* Header row */}
                    <div className="flex justify-between items-start">
                      <div>
                        <h5 className="font-bold text-sm text-zinc-900">
                          {p.firstName} {p.lastName}
                        </h5>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          {p.role}
                        </span>
                      </div>
                      <button
                        onClick={() => onEditPersonnel(p)}
                        className="flex items-center gap-1 px-2 py-1 border border-zinc-200 hover:bg-zinc-50 rounded text-[10px] font-bold uppercase tracking-wide text-zinc-500 transition-colors"
                        title="Edit qualifications & time off"
                      >
                        <Edit2 className="h-3 w-3" />
                        Edit
                      </button>
                    </div>

                    {/* Qualification tags */}
                    {p.qualifications.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.qualifications.map((q) => {
                          const expired = q.expiresAt && new Date(q.expiresAt) < new Date();
                          return (
                            <span
                              key={q.id}
                              title={[q.issuedBy, q.expiresAt ? `Exp: ${new Date(q.expiresAt).toLocaleDateString()}` : null, q.notes].filter(Boolean).join(" · ")}
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${expired ? "bg-red-100 text-red-700 line-through" : (CATEGORY_COLORS[q.category] ?? "bg-zinc-100 text-zinc-700")}`}
                            >
                              {q.tag}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Upcoming time off */}
                    {upcoming.length > 0 && (
                      <div className="space-y-1">
                        {upcoming.map((t) => (
                          <div key={t.id} className={`flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded ${TIMEOFF_COLORS[t.type] ?? "bg-zinc-100 text-zinc-700"}`}>
                            <CalendarOff className="h-3 w-3 shrink-0" />
                            {t.type}: {new Date(t.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(t.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Time ledger */}
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Time Tracking Ledger
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="py-2 px-4">Technician</th>
                  <th className="py-2 px-4">Job Client</th>
                  <th className="py-2 px-4">Date</th>
                  <th className="py-2 px-4">Duration</th>
                  <th className="py-2 px-4">Payroll Item</th>
                  <th className="py-2 px-4">QB Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-xs">
                {data.timeEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 px-4 text-center text-zinc-500">
                      No labor hours logged yet.
                    </td>
                  </tr>
                ) : (
                  data.timeEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-zinc-50">
                      <td className="py-3 px-4 font-semibold">
                        {entry.personnel.firstName} {entry.personnel.lastName}
                      </td>
                      <td className="py-3 px-4">{entry.job.client.name}</td>
                      <td className="py-3 px-4">{formatDate(entry.date)}</td>
                      <td className="py-3 px-4 font-mono font-bold text-zinc-700">{entry.duration}</td>
                      <td className="py-3 px-4 text-zinc-500">{entry.payrollItem}</td>
                      <td className="py-3 px-4">
                        <SyncStatusBadge status={entry.qbTimeSyncStatus} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
