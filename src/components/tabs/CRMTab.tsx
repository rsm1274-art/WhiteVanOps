"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Repeat, Play, Pause, Trash2, RotateCw, StickyNote, CalendarCheck, Check, ChevronDown, ChevronUp, MoreHorizontal, Phone } from "lucide-react";
import { Client, ClientFollowUp, DashboardData, Job, JobStatus, RecurringJobTemplate } from "@/types";
import { JobStatusBadge, SyncStatusBadge } from "@/components/shared/StatusBadge";
import { formatDate, todayLocalStr, dateToLocalStr } from "@/lib/dateUtils";
import { arrivalLabel } from "@/lib/arrival";

type DateRange = "All" | "Today" | "This Week";

/** yyyy-mm-dd bounds (Mon–Sun) of the current local week. */
function currentWeekBounds(): [string, string] {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 12);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12);
  return [dateToLocalStr(monday.toISOString()), dateToLocalStr(sunday.toISOString())];
}

/** "⋯" overflow menu for the less-used job row actions. */
function RowMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="More actions"
        className="p-1.5 border border-zinc-300 hover:bg-zinc-50 rounded"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 min-w-[8rem] bg-white border border-zinc-200 rounded shadow-lg py-1 text-left">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={`block w-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-zinc-50 text-left ${
                item.danger ? "text-red-700" : "text-zinc-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ALL_STATUSES: JobStatus[] = ["Scheduled", "In Progress", "Completed", "Cancelled"];

const FREQUENCY_LABELS: Record<string, string> = {
  Weekly: "Every week",
  Biweekly: "Every 2 weeks",
  Monthly: "Every month",
};

interface Props {
  data: DashboardData;
  onAddClient: () => void;
  onEditClient: (client: Client) => void;
  onAddJob: () => void;
  onStartJob: (jobId: string) => void;
  onCompleteJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onCloneJob: (job: Job) => void;
  onOpenResources: (job: Job) => void;
  onOpenCosts: (job: Job) => void;
  onEditJob: (job: Job) => void;
  onReopenJob: (jobId: string) => void;
  onAddRecurringJob: () => void;
  onEditRecurringJob: (template: RecurringJobTemplate) => void;
  onGenerateRecurringJob: (template: RecurringJobTemplate) => void;
  onToggleRecurringActive: (template: RecurringJobTemplate) => void;
  onDeleteRecurringJob: (template: RecurringJobTemplate) => void;
  // Plus tier — CRM notes & follow-ups (undefined handlers on Base installs)
  onAddNote?: (client: Client) => void;
  onAddFollowUp?: (client: Client) => void;
  onEditFollowUp?: (client: Client, followUp: ClientFollowUp) => void;
  onToggleFollowUp?: (followUp: ClientFollowUp) => void;
  onDeleteFollowUp?: (followUp: ClientFollowUp) => void;
}

export default function CRMTab({
  data,
  onAddClient,
  onEditClient,
  onAddJob,
  onStartJob,
  onCompleteJob,
  onCancelJob,
  onCloneJob,
  onOpenResources,
  onOpenCosts,
  onEditJob,
  onReopenJob,
  onAddRecurringJob,
  onEditRecurringJob,
  onGenerateRecurringJob,
  onToggleRecurringActive,
  onDeleteRecurringJob,
  onAddNote,
  onAddFollowUp,
  onEditFollowUp,
  onToggleFollowUp,
  onDeleteFollowUp,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<JobStatus | "All">("All");
  const [dateRange, setDateRange] = useState<DateRange>("All");
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);

  const today = todayLocalStr();

  const [weekStart, weekEnd] = currentWeekBounds();
  const inRange = (j: Job) => {
    const d = dateToLocalStr(j.scheduledDate);
    if (dateRange === "Today") return d === today;
    if (dateRange === "This Week") return d >= weekStart && d <= weekEnd;
    return true;
  };

  // Newest day first (as the API returns them), then by arrival time within a day.
  const filteredJobs = data.jobs
    .filter((j) => (statusFilter === "All" || j.status === statusFilter) && inRange(j))
    .sort((a, b) => {
      const da = dateToLocalStr(a.scheduledDate);
      const db = dateToLocalStr(b.scheduledDate);
      if (da !== db) return da < db ? 1 : -1;
      return (a.arrivalTime || "99:99").localeCompare(b.arrivalTime || "99:99");
    });

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Operational Log</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Manage client records, schedule jobs, credit materials/equipment, and track costs.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAddClient}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Client
          </button>
          <button
            onClick={onAddJob}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Schedule Job
          </button>
        </div>
      </div>

      {/* Clients */}
      <div className="bg-white border border-zinc-200 rounded p-6">
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
          Client CRM Records ({data.clients.length} accounts)
        </h4>
        {data.clients.length === 0 ? (
          <p className="text-sm text-zinc-500">No clients yet. Add one above.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {data.clients.map((c) => {
              const notes = c.notes ?? [];
              const followUps = c.followUps ?? [];
              const openFollowUps = followUps.filter((f) => !f.completed);
              const dueCount = openFollowUps.filter((f) => dateToLocalStr(f.dueDate) <= today).length;
              const expanded = expandedClientId === c.id;
              return (
                <div key={c.id} className="p-4 border border-zinc-100 rounded bg-zinc-50">
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="font-bold text-sm">{c.name}</h5>
                    <button
                      onClick={() => onEditClient(c)}
                      title="Edit client"
                      className="p-1 text-zinc-400 hover:text-zinc-800"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="text-[10px] text-zinc-400 block font-semibold mt-0.5">
                    Contact: {c.contactName}
                  </span>
                  {c.contactPhone && (
                    <a
                      href={`tel:${c.contactPhone}`}
                      className="text-[11px] text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1 mt-0.5"
                    >
                      <Phone className="h-3 w-3" />
                      {c.contactPhone}
                    </a>
                  )}
                  <p className="text-xs text-zinc-500 mt-2">{c.locationAddress}</p>
                  <div className="mt-3 pt-2 border-t border-zinc-100 flex justify-between items-center text-xs">
                    <span className="text-zinc-400">Terms:</span>
                    <span className="font-semibold">{c.paymentTerms}</span>
                  </div>

                  {/* Notes & follow-ups panel */}
                    <div className="mt-3 pt-2 border-t border-zinc-100">
                      <button
                        onClick={() => setExpandedClientId(expanded ? null : c.id)}
                        className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <StickyNote className="h-3 w-3" />
                          {notes.length} note{notes.length !== 1 && "s"} · {openFollowUps.length} follow-up{openFollowUps.length !== 1 && "s"}
                          {dueCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">{dueCount} due</span>
                          )}
                        </span>
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      {expanded && (
                        <div className="mt-3 space-y-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => onAddNote?.(c)}
                              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 border border-zinc-300 bg-white hover:bg-zinc-100 text-[10px] font-bold uppercase tracking-wider rounded transition-colors"
                            >
                              <StickyNote className="h-3 w-3" />
                              Add Note
                            </button>
                            <button
                              onClick={() => onAddFollowUp?.(c)}
                              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 border border-zinc-300 bg-white hover:bg-zinc-100 text-[10px] font-bold uppercase tracking-wider rounded transition-colors"
                            >
                              <CalendarCheck className="h-3 w-3" />
                              Follow-Up
                            </button>
                          </div>

                          {openFollowUps.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">Open Follow-Ups</p>
                              {openFollowUps.map((f) => {
                                const due = dateToLocalStr(f.dueDate) <= today;
                                return (
                                  <div key={f.id} className="flex items-start gap-2 p-2 bg-white border border-zinc-200 rounded">
                                    <button
                                      onClick={() => onToggleFollowUp?.(f)}
                                      title="Mark completed"
                                      className="mt-0.5 p-0.5 border border-zinc-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-600 rounded shrink-0"
                                    >
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs text-zinc-700 leading-snug">{f.note}</p>
                                      <p className={`text-[10px] mt-0.5 font-semibold ${due ? "text-red-600" : "text-zinc-400"}`}>
                                        Due {formatDate(f.dueDate)}
                                        {f.assignedTo && ` · ${f.assignedTo.firstName} ${f.assignedTo.lastName}`}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => onEditFollowUp?.(c, f)}
                                      title="Edit follow-up"
                                      className="p-1 text-zinc-400 hover:text-zinc-700 shrink-0"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => onDeleteFollowUp?.(f)}
                                      title="Delete follow-up"
                                      className="p-1 text-zinc-400 hover:text-red-600 shrink-0"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {notes.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">Notes</p>
                              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                {notes.map((n) => (
                                  <div key={n.id} className="p-2 bg-white border border-zinc-200 rounded">
                                    <p className="text-xs text-zinc-700 leading-snug whitespace-pre-wrap">{n.body}</p>
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                      {formatDate(n.createdAt)}
                                      {n.author && ` · ${n.author.displayName}`}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recurring Jobs */}
      <div className="bg-white border border-zinc-200 rounded p-6">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Recurring Jobs ({data.recurringJobTemplates.length} templates)
          </h4>
          <button
            onClick={onAddRecurringJob}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-300 hover:bg-zinc-50 text-[10px] font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Repeat className="h-3 w-3" />
            New Recurring Job
          </button>
        </div>
        {data.recurringJobTemplates.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No recurring jobs set up. Use this for clients you service on a regular cadence instead of scheduling each visit by hand.
          </p>
        ) : (
          <div className="space-y-2">
            {data.recurringJobTemplates.map((t) => (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-3 p-3 border rounded ${t.active ? "border-zinc-200" : "border-zinc-100 bg-zinc-50 opacity-60"}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-zinc-800">{t.client.name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
                      {FREQUENCY_LABELS[t.frequency] ?? t.frequency}
                    </span>
                    {!t.active && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Starts {formatDate(t.startDate)}
                    {t.endDate && <> · Ends {formatDate(t.endDate)}</>}
                    {t.lastGeneratedDate && <> · Last generated {formatDate(t.lastGeneratedDate)}</>}
                    {t.vehicle && <> · {t.vehicle.make} {t.vehicle.model}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onGenerateRecurringJob(t)}
                    disabled={!t.active}
                    title="Generate the next batch of jobs from this template"
                    className="px-2.5 py-1 text-xs bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                  >
                    <RotateCw className="h-3 w-3" />
                    Generate
                  </button>
                  <button
                    onClick={() => onEditRecurringJob(t)}
                    title="Edit template"
                    className="p-1.5 border border-zinc-300 hover:bg-zinc-50 rounded"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onToggleRecurringActive(t)}
                    title={t.active ? "Pause" : "Resume"}
                    className="p-1.5 border border-zinc-300 hover:bg-zinc-50 rounded"
                  >
                    {t.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => onDeleteRecurringJob(t)}
                    title="Delete template"
                    className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Jobs table — no overflow-hidden, or the row "⋯" menus get clipped */}
      <div className="bg-white border border-zinc-200 rounded">
        {/* Filter toolbar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-200 bg-zinc-50">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-2">
            Filter:
          </span>
          {(["All", ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors ${
                statusFilter === s
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {s}
            </button>
          ))}
          <span className="w-px h-4 bg-zinc-300 mx-2" />
          {(["All", "Today", "This Week"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors ${
                dateRange === r
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {r === "All" ? "Any Date" : r}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-zinc-400">{filteredJobs.length} jobs</span>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <th className="py-3.5 px-6">Job ID</th>
              <th className="py-3.5 px-6">Client / Notes</th>
              <th className="py-3.5 px-6">Assigned Van</th>
              <th className="py-3.5 px-6">Technicians</th>
              <th className="py-3.5 px-6">Scheduled</th>
              <th className="py-3.5 px-6">Status</th>
              <th className="py-3.5 px-6">QB Sync</th>
              <th className="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 text-sm">
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 px-6 text-center text-zinc-500">
                  No jobs match the selected filter.
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => (
                <tr key={job.id} className="hover:bg-zinc-50">
                  <td className="py-4 px-6 font-mono text-xs text-zinc-500 align-top">
                    #{job.id.substring(0, 8)}
                  </td>
                  <td className="py-4 px-6 align-top">
                    <span className="font-semibold">{job.client.name}</span>
                    {job.recurringTemplateId && (
                      <span
                        title="Auto-generated from a recurring job template"
                        className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500"
                      >
                        <Repeat className="h-2.5 w-2.5" />
                        Recurring
                      </span>
                    )}
                    {job.notes && (
                      <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
                        {job.notes}
                      </p>
                    )}
                  </td>
                  <td className="py-4 px-6 text-zinc-600 align-top">
                    {job.vehicle ? (
                      `${job.vehicle.make} ${job.vehicle.model}`
                    ) : (
                      <span className="text-zinc-400">None Assigned</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-zinc-600 align-top">
                    {job.assignments.length > 0 ? (
                      job.assignments
                        .map((a) => `${a.personnel.firstName} ${a.personnel.lastName}`)
                        .join(", ")
                    ) : (
                      <span className="text-zinc-400">None</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-zinc-600 align-top">
                    {formatDate(job.scheduledDate)}
                    {arrivalLabel(job) && (
                      <span className="block text-xs text-zinc-500 font-mono mt-0.5 whitespace-nowrap">{arrivalLabel(job)}</span>
                    )}
                  </td>
                  <td className="py-4 px-6 align-top">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="py-4 px-6 align-top">
                    {job.status === "Completed" ? (
                      <SyncStatusBadge status={job.qbInvoiceSyncStatus} />
                    ) : (
                      <span className="text-zinc-400 text-xs">N/A</span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right align-top">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {job.status === "Completed" && (
                        <button
                          onClick={() => onReopenJob(job.id)}
                          className="px-2.5 py-1 text-xs border border-zinc-300 hover:bg-zinc-50 font-bold uppercase tracking-wide text-blue-700 hover:text-blue-900 rounded inline-flex items-center gap-1"
                          title="Re-open this completed job"
                        >
                          Re-open
                        </button>
                      )}

                      {job.status === "Scheduled" && (
                        <button
                          onClick={() => onStartJob(job.id)}
                          className="px-2.5 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white font-bold uppercase tracking-wide rounded"
                        >
                          Start
                        </button>
                      )}

                      {job.status !== "Completed" && job.status !== "Cancelled" && (
                        <>
                          <button
                            onClick={() => onEditJob(job)}
                            className="px-2.5 py-1 text-xs border border-zinc-300 hover:bg-zinc-50 font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                            title="Edit client, vehicle, date, arrival, or notes"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => onOpenResources(job)}
                            className="px-2.5 py-1 text-xs border border-zinc-300 hover:bg-zinc-50 font-bold uppercase tracking-wide rounded"
                          >
                            Resources
                          </button>
                          <button
                            onClick={() => onCompleteJob(job.id)}
                            className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-wide rounded"
                          >
                            Complete
                          </button>
                        </>
                      )}

                      <RowMenu
                        items={[
                          { label: "Costs", onClick: () => onOpenCosts(job) },
                          { label: "Clone", onClick: () => onCloneJob(job) },
                          ...(job.status !== "Completed" && job.status !== "Cancelled"
                            ? [{ label: "Cancel Job", onClick: () => onCancelJob(job.id), danger: true }]
                            : []),
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
