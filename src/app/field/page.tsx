"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { cacheApiResponse, getCachedApiResponse, getSyncQueue, getStuckOps, type StuckOp } from "@/lib/idb";
import { submitWrite, drainSyncQueue } from "@/lib/offlineWrite";
import { discardStuckOp, retargetStuckOp, handoffStuckOp } from "@/lib/syncResolution";
import {
  Briefcase,
  Clock,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  ArrowLeft,
  RotateCw,
  AlertTriangle,
  MapPin,
  Truck,
  Users,
  Wrench,
  FileText,
  Package,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  defaultRate: number;
}

interface LineItem {
  id: string;
  inventoryItemId: string;
  inventoryItem: InventoryItem;
  quantity: number;
  rate: number;
  description: string;
}

interface TimeEntry {
  id: string;
  date: string;
  duration: string;
  serviceItem: string;
}

interface FieldJob {
  id: string;
  status: string;
  scheduledDate: string;
  completionDate: string | null;
  notes: string | null;
  client: { name: string; contactName: string; locationAddress: string };
  vehicle: { make: string; model: string } | null;
  assignments: { personnel: Personnel }[];
  lineItems: LineItem[];
  equipment: { equipment: { id: string; name: string } }[];
  timeEntries: TimeEntry[];
}

type ActivePanel = "time" | "note" | "materials" | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  Scheduled: "bg-blue-100 text-blue-800",
  "In Progress": "bg-amber-100 text-amber-800",
  Completed: "bg-emerald-100 text-emerald-800",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Plain-words description of a stuck op for its card, e.g. "Time entry — 01:30 on 2026-07-15". */
function describeStuckOp(op: StuckOp, jobs: FieldJob[]): { what: string; why: string; isStatusChange: boolean } {
  const body = (op.body ?? {}) as Record<string, unknown>;
  const job = jobs.find((j) => j.id === body.jobId);
  const target = job ? `job for ${job.client?.name ?? job.id.substring(0, 8)}` : "a job that is no longer available";

  let what: string;
  const isStatusChange = op.url === "/api/jobs" && typeof body.status === "string";
  if (op.url === "/api/time") what = `Time entry — ${body.duration} on ${body.date}`;
  else if (isStatusChange) what = `Status change → ${body.status}`;
  else if ("notes" in body) what = "Job notes";
  else if ("lineItems" in body) what = "Materials update";
  else what = `${op.method} ${op.url}`;

  const why =
    op.status === 404
      ? "That job no longer exists."
      : `The server rejected it: ${op.message}`;

  return { what: `${what} — ${target}`, why, isStatusChange };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-bold uppercase tracking-wide transition-colors border ${
        active
          ? "bg-zinc-900 text-white border-zinc-900"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// Log Time panel
function LogTimePanel({
  job,
  techId,
  onSuccess,
  onError,
}: {
  job: FieldJob;
  techId: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [serviceItem, setServiceItem] = useState("Field Labor");
  const [saving, setSaving] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    if (h === 0 && m === 0) { onError("Duration must be greater than zero."); return; }
    const duration = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const date = dateRef.current?.value || todayStr();
    setSaving(true);
    try {
      await submitWrite("/api/time", "POST", { jobId: job.id, personnelId: techId, date, duration, serviceItem, payrollItem: "Regular Pay" });
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to log time");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Log Time</p>

      {job.timeEntries.length > 0 && (
        <div className="mb-4 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Your logged entries</p>
          {job.timeEntries.map((te) => (
            <div key={te.id} className="flex justify-between text-xs bg-white border border-zinc-100 rounded px-3 py-1.5">
              <span className="text-zinc-600">{formatDate(te.date)} — {te.serviceItem}</span>
              <span className="font-mono font-bold text-zinc-800">{te.duration}</span>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">Hours</label>
            <input
              type="text" inputMode="numeric" placeholder="0" value={hours}
              onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm font-mono text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">Minutes</label>
            <input
              type="text" inputMode="numeric" placeholder="0" value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
              className="w-full border border-zinc-300 rounded px-3 py-2 text-sm font-mono text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">Date</label>
          <input
            type="date" ref={dateRef} defaultValue={todayStr()}
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1">Service Type</label>
          <select
            value={serviceItem} onChange={(e) => setServiceItem(e.target.value)}
            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            <option>Field Labor</option>
            <option>Installation</option>
            <option>Repair</option>
            <option>Inspection</option>
            <option>Travel</option>
          </select>
        </div>
        <button
          type="submit" disabled={saving}
          className="w-full py-2.5 bg-zinc-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Submit Time Entry"}
        </button>
      </form>
    </div>
  );
}

// Notes panel
function NotesPanel({
  job,
  onSuccess,
  onError,
}: {
  job: FieldJob;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [note, setNote] = useState(job.notes ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await submitWrite("/api/jobs", "PUT", { jobId: job.id, notes: note });
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Job Notes</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add site observations, access instructions, issues encountered…"
          className="w-full border border-zinc-300 rounded px-3 py-2 text-sm text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none"
        />
        <button
          type="submit" disabled={saving}
          className="w-full py-2.5 bg-zinc-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Notes"}
        </button>
      </form>
    </div>
  );
}

// Materials panel
function MaterialsPanel({
  job,
  inventoryItems,
  onSuccess,
  onError,
}: {
  job: FieldJob;
  inventoryItems: InventoryItem[];
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [lines, setLines] = useState(
    job.lineItems.map((li) => ({
      inventoryItemId: li.inventoryItemId,
      quantity: String(li.quantity),
      rate: String(li.rate),
      description: li.description,
    }))
  );
  const [saving, setSaving] = useState(false);

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { inventoryItemId: inventoryItems[0]?.id ?? "", quantity: "1", rate: "", description: "" },
    ]);

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: string, value: string) =>
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const updated = { ...l, [field]: value };
        if (field === "inventoryItemId") {
          const item = inventoryItems.find((it) => it.id === value);
          if (item) updated.rate = String(item.defaultRate);
        }
        return updated;
      })
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await submitWrite("/api/jobs", "PUT", { jobId: job.id, lineItems: lines });
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save materials");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 p-4 bg-zinc-50 border border-zinc-200 rounded-lg">
      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">Materials Used</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        {lines.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-2">No materials listed yet.</p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="bg-white border border-zinc-200 rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Item {i + 1}</span>
              <button
                type="button" onClick={() => removeLine(i)}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <select
              value={line.inventoryItemId}
              onChange={(e) => updateLine(i, "inventoryItemId", e.target.value)}
              className="w-full border border-zinc-300 rounded px-2 py-1.5 text-xs text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
            >
              {inventoryItems.map((it) => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-zinc-400 mb-0.5">Qty</label>
                <input
                  type="text" inputMode="numeric" placeholder="1" value={line.quantity}
                  onChange={(e) => updateLine(i, "quantity", e.target.value.replace(/\D/g, ""))}
                  className="w-full border border-zinc-300 rounded px-2 py-1.5 text-xs font-mono text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-0.5">Rate ($)</label>
                <input
                  type="text" inputMode="decimal" placeholder="0.00" value={line.rate}
                  onChange={(e) => updateLine(i, "rate", e.target.value.replace(/[^\d.]/g, ""))}
                  className="w-full border border-zinc-300 rounded px-2 py-1.5 text-xs font-mono text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>
            <input
              type="text" placeholder="Description (optional)" value={line.description}
              onChange={(e) => updateLine(i, "description", e.target.value)}
              className="w-full border border-zinc-300 rounded px-2 py-1.5 text-xs text-zinc-900 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        ))}
        <button
          type="button" onClick={addLine}
          className="w-full py-2 border border-dashed border-zinc-300 text-zinc-500 text-xs font-bold uppercase tracking-wide rounded hover:bg-zinc-100 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Add Material
        </button>
        <button
          type="submit" disabled={saving}
          className="w-full py-2.5 bg-zinc-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Materials"}
        </button>
      </form>
    </div>
  );
}

// Job card
function JobCard({
  job,
  techId,
  inventoryItems,
  onRefresh,
  onError,
}: {
  job: FieldJob;
  techId: string;
  inventoryItems: InventoryItem[];
  onRefresh: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [actioning, setActioning] = useState(false);

  const togglePanel = (panel: ActivePanel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  const changeStatus = async (status: string) => {
    setActioning(true);
    try {
      await submitWrite("/api/jobs", "PUT", { jobId: job.id, status });
      onRefresh();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setActioning(false);
    }
  };

  const crew = job.assignments.map((a) => `${a.personnel.firstName} ${a.personnel.lastName}`).join(", ");
  const isCompleted = job.status === "Completed";

  return (
    <div className={`bg-white border rounded-xl overflow-hidden shadow-sm ${isCompleted ? "opacity-70" : "border-zinc-200"}`}>
      {/* Card header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_COLORS[job.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                {job.status}
              </span>
              <span className="text-[10px] text-zinc-400 font-medium">{formatDate(job.scheduledDate)}</span>
            </div>
            <h3 className="font-bold text-zinc-900 text-base leading-tight truncate">{job.client.name}</h3>
            <div className="flex items-center gap-1 mt-1 text-xs text-zinc-500">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{job.client.locationAddress}</span>
            </div>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors shrink-0 mt-0.5"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
          </button>
        </div>

        {/* Quick stats row */}
        <div className="flex gap-4 mt-3 text-[10px] text-zinc-500 font-medium uppercase tracking-wide">
          {job.vehicle && (
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3" />
              {job.vehicle.make} {job.vehicle.model}
            </span>
          )}
          {crew && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {crew}
            </span>
          )}
          {job.timeEntries.length > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {job.timeEntries.length} entr{job.timeEntries.length === 1 ? "y" : "ies"}
            </span>
          )}
          {job.lineItems.length > 0 && (
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" />
              {job.lineItems.length} material{job.lineItems.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-zinc-100 pt-4 space-y-4">
          {/* Equipment */}
          {job.equipment.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Equipment on this Job
              </p>
              <div className="flex flex-wrap gap-1.5">
                {job.equipment.map((je) => (
                  <span key={je.equipment.id} className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[10px] font-semibold rounded">
                    {je.equipment.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!isCompleted && (
            <div className="flex flex-wrap gap-2">
              {job.status === "Scheduled" && (
                <button
                  onClick={() => changeStatus("In Progress")}
                  disabled={actioning}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white text-xs font-bold uppercase tracking-wide rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  Start Job
                </button>
              )}
              {job.status === "In Progress" && (
                <button
                  onClick={() => changeStatus("Completed")}
                  disabled={actioning}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-bold uppercase tracking-wide rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Mark Complete
                </button>
              )}
            </div>
          )}

          {/* Panel toggles */}
          <div className="flex flex-wrap gap-2">
            <SectionButton
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Log Time"
              active={activePanel === "time"}
              onClick={() => togglePanel("time")}
            />
            <SectionButton
              icon={<FileText className="h-3.5 w-3.5" />}
              label="Notes"
              active={activePanel === "note"}
              onClick={() => togglePanel("note")}
            />
            <SectionButton
              icon={<Package className="h-3.5 w-3.5" />}
              label="Materials"
              active={activePanel === "materials"}
              onClick={() => togglePanel("materials")}
            />
          </div>

          {activePanel === "time" && (
            <LogTimePanel
              job={job}
              techId={techId}
              onSuccess={() => { onRefresh(); setActivePanel(null); }}
              onError={onError}
            />
          )}
          {activePanel === "note" && (
            <NotesPanel
              job={job}
              onSuccess={() => { onRefresh(); setActivePanel(null); }}
              onError={onError}
            />
          )}
          {activePanel === "materials" && (
            <MaterialsPanel
              job={job}
              inventoryItems={inventoryItems}
              onSuccess={() => { onRefresh(); setActivePanel(null); }}
              onError={onError}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StuckOpsPanel({
  stuckOps,
  jobs,
  onClose,
  onResolved,
  onError,
}: {
  stuckOps: StuckOp[];
  jobs: FieldJob[];
  onClose: () => void;
  onResolved: (message: string) => void;
  onError: (message: string, isError?: boolean) => void;
}) {
  const [retargetFor, setRetargetFor] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const message = await fn();
      if (message) onResolved(message);
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = (op: StuckOp) =>
    act(async () => {
      if (!window.confirm("Discard this entry? The office keeps a record of what was discarded.")) return null;
      const result = await discardStuckOp(op);
      if (result === "failed") {
        onError("Could not reach the office to record the discard. The entry is kept.", true);
        return null;
      }
      return "Entry discarded. The office has a record of it.";
    });

  const handleHandoff = (op: StuckOp) =>
    act(async () => {
      const result = await handoffStuckOp(op);
      if (result === "failed") {
        onError("Could not reach the office. The entry is kept.", true);
        return null;
      }
      return "Sent to the office for review.";
    });

  const handleRetarget = (op: StuckOp) =>
    act(async () => {
      if (!selectedJobId) return null;
      const result = await retargetStuckOp(op, selectedJobId);
      if (result === "unreachable") {
        onError("Could not reach the office. The entry is kept.", true);
        return null;
      }
      if (result === "rejected") {
        onError("The server rejected it for that job too. The entry is kept.", true);
        return null;
      }
      setRetargetFor(null);
      return "Entry saved to the selected job.";
    });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">Entries needing attention</h3>
          <button onClick={onClose} className="text-zinc-400 text-xs font-bold uppercase">Close</button>
        </div>
        {stuckOps.map((op) => {
          const { what, why, isStatusChange } = describeStuckOp(op, jobs);
          return (
            <div key={op.id} className="border border-zinc-700 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-zinc-100">{what}</p>
              <p className="text-xs text-amber-500">{why}</p>
              {retargetFor === op.id ? (
                <div className="space-y-2">
                  <select
                    value={selectedJobId}
                    onChange={(e) => setSelectedJobId(e.target.value)}
                    className="w-full p-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-zinc-100"
                  >
                    <option value="">Choose one of your jobs…</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.client?.name ?? j.id.substring(0, 8)} — {j.scheduledDate?.substring(0, 10)}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button disabled={busy || !selectedJobId} onClick={() => handleRetarget(op)} className="flex-1 py-2 bg-blue-700 rounded text-xs font-bold uppercase text-white disabled:opacity-50">Save to this job</button>
                    <button disabled={busy} onClick={() => setRetargetFor(null)} className="py-2 px-3 bg-zinc-800 rounded text-xs font-bold uppercase text-zinc-300">Cancel</button>
                  </div>
                  <p className="text-[10px] text-zinc-500">Don&apos;t see the right job? It may not be assigned to you — use &quot;Send to office&quot; instead.</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  {!isStatusChange && (
                    <button disabled={busy} onClick={() => { setRetargetFor(op.id!); setSelectedJobId(""); }} className="flex-1 py-2 bg-blue-700 rounded text-xs font-bold uppercase text-white disabled:opacity-50">Re-target</button>
                  )}
                  <button disabled={busy} onClick={() => handleHandoff(op)} className="flex-1 py-2 bg-zinc-700 rounded text-xs font-bold uppercase text-zinc-100 disabled:opacity-50">Send to office</button>
                  <button disabled={busy} onClick={() => handleDiscard(op)} className="py-2 px-3 bg-red-900/60 rounded text-xs font-bold uppercase text-red-200 disabled:opacity-50">Discard</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function FieldPage() {
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [tech, setTech] = useState<Personnel | null>(null);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(false);
  const [stuckOps, setStuckOps] = useState<StuckOp[]>([]);
  const [showStuckPanel, setShowStuckPanel] = useState(false);

  const checkSyncStatus = async () => {
    try {
      const q = await getSyncQueue();
      setPendingSync(q.length > 0);
      setStuckOps(await getStuckOps());
    } catch { }
  };

  const showToast = (text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 5000);
  };

  const processSync = async () => {
    try {
      const { synced, stuck, stopped } = await drainSyncQueue();
      if (stopped === "auth") {
        showToast("Session expired. Log in again to sync your changes.", true);
        return;
      }
      if (synced === 0 && stuck === 0) return;
      checkSyncStatus();
      if (tech) loadJobs(tech.id);
      if (stuck > 0) {
        showToast(`${stuck} change${stuck === 1 ? "" : "s"} could not be saved and need${stuck === 1 ? "s" : ""} your attention.`, true);
      } else {
        showToast(
          stopped === "complete"
            ? "Background sync completed. All changes saved to server."
            : `Synced ${synced} change${synced === 1 ? "" : "s"}. The rest are still queued.`
        );
      }
    } catch (err) {
      console.error("Sync failed", err);
    }
  };

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const onOnline = () => { setIsOnline(true); processSync(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    checkSyncStatus();

    // Drain on mount, not just on an online event: if the server was down while
    // the device kept its connection, no online event ever fires and queued
    // writes would otherwise sit here indefinitely.
    processSync();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [tech]); // processSync needs current tech for loadJobs

  const onActionSuccess = () => {
    checkSyncStatus();
    if (tech) loadJobs(tech.id);
  };

  // Load personnel list on mount; auto-select if session user is a tech with a linked record
  useEffect(() => {
    Promise.all([
      fetch("/api/field").then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then(data => { cacheApiResponse("/api/field", data); return data; })
        .catch(async () => {
          const cached = await getCachedApiResponse("/api/field");
          if (cached) return cached;
          throw new Error("No offline cache for field metadata");
        }),
      fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([fieldData, sessionUser]) => {
        const personnel: Personnel[] = fieldData.personnel ?? [];
        setAllPersonnel(personnel);

        // If the logged-in user is a tech linked to a Personnel record, auto-select
        if (sessionUser?.role === "tech" && sessionUser?.personnelId) {
          const linked = personnel.find((p: Personnel) => p.id === sessionUser.personnelId);
          if (linked) {
            setTech(linked);
            setLoading(false);
            return;
          }
        }

        // Fall back to localStorage
        const savedId = localStorage.getItem("fieldTechId");
        if (savedId) {
          const found = personnel.find((p: Personnel) => p.id === savedId);
          if (found) setTech(found);
        }
        setLoading(false);
      })
      .catch(() => {
        showToast("Failed to connect to server", true);
        setLoading(false);
      });
  }, []);

  const loadJobs = useCallback(async (personnelId: string) => {
    setLoading(true);
    const url = `/api/field?personnelId=${personnelId}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setInventoryItems(data.inventoryItems ?? []);
      await cacheApiResponse(url, data);
    } catch {
      const cached = await getCachedApiResponse(url);
      if (cached) {
        setJobs(cached.jobs ?? []);
        setInventoryItems(cached.inventoryItems ?? []);
        showToast("Loaded jobs from offline cache", false);
      } else {
        showToast("Failed to load assignments", true);
      }
    } finally {
      setLoading(false);
      checkSyncStatus();
    }
  }, []);

  useEffect(() => {
    // Intentional: load this tech's jobs whenever the selected tech changes.
    // `loadJobs` is a useCallback reused elsewhere (e.g. after status
    // updates), so it stays a named function rather than an inline effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tech) loadJobs(tech.id);
  }, [tech, loadJobs]);

  const selectTech = (p: Personnel) => {
    localStorage.setItem("fieldTechId", p.id);
    setTech(p);
  };

  const signOut = () => {
    localStorage.removeItem("fieldTechId");
    setTech(null);
    setJobs([]);
  };

  const filteredJobs = jobs.filter((j) => {
    if (statusFilter === "active") return j.status !== "Completed";
    if (statusFilter === "completed") return j.status === "Completed";
    return true;
  });

  // ---------------------------------------------------------------------------
  // Technician picker screen
  // ---------------------------------------------------------------------------
  if (!tech) {
    return (
      <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="White Van Ops" className="inline-block h-16 w-16 rounded-2xl mb-4" />
            <h1 className="text-2xl font-bold text-white tracking-tight">Field Module</h1>
            <p className="text-zinc-400 text-sm mt-1">White Van Operations</p>
          </div>

          {loading ? (
            <div className="text-center text-zinc-500 text-sm">Loading…</div>
          ) : allPersonnel.length === 0 ? (
            <p className="text-center text-zinc-500 text-sm">No technicians configured.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 text-center mb-4">
                Who are you?
              </p>
              {allPersonnel.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectTech(p)}
                  className="w-full flex items-center gap-3 px-4 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-left transition-colors group"
                >
                  <div className="h-9 w-9 rounded-full bg-zinc-700 group-hover:bg-zinc-600 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-white">
                      {p.firstName[0]}{p.lastName[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{p.firstName} {p.lastName}</p>
                    <p className="text-zinc-400 text-xs">{p.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main field view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <header className="bg-zinc-900 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold">
            {tech.firstName[0]}{tech.lastName[0]}
          </div>
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide font-semibold">Field Module</p>
            <p className="text-sm font-bold leading-tight">{tech.firstName} {tech.lastName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="text-[10px] bg-red-900/50 text-red-100 px-2 py-1 rounded font-bold uppercase tracking-widest flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Offline
            </span>
          )}
          {pendingSync && isOnline && (
            <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-1 rounded font-bold uppercase tracking-widest flex items-center gap-1">
              Syncing...
            </span>
          )}
          <button
            onClick={() => loadJobs(tech.id)}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            title="Refresh"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase tracking-wide transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Switch
          </button>
        </div>
      </header>

      {stuckOps.length > 0 && (
        <button
          onClick={() => setShowStuckPanel(true)}
          className="w-full flex items-center gap-2 bg-amber-500/15 border border-amber-500/40 text-amber-500 text-xs font-bold uppercase tracking-wider rounded-lg px-4 py-3"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {stuckOps.length} {stuckOps.length === 1 ? "entry needs" : "entries need"} attention
        </button>
      )}

      {/* Admin link */}
      <div className="bg-zinc-800 text-center py-1.5">
        <Link href="/" className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors">
          ← Back to Admin Dashboard
        </Link>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mx-4 mt-4 p-3 rounded-lg flex items-center justify-between text-sm font-semibold ${
          toast.isError ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200"
        }`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} className="ml-4 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-4">
        {/* Summary + filter */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your Assignments</p>
            <p className="text-2xl font-bold text-zinc-900">{filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex gap-1.5 bg-white border border-zinc-200 rounded-lg p-1">
            {[
              { key: "active", label: "Active" },
              { key: "completed", label: "Done" },
              { key: "all", label: "All" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
                  statusFilter === key ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <RotateCw className="h-6 w-6 animate-spin mb-3" />
            <p className="text-sm font-medium uppercase tracking-wide">Loading assignments…</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <AlertTriangle className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">No {statusFilter === "all" ? "" : statusFilter + " "}assignments found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredJobs.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              techId={tech.id}
              inventoryItems={inventoryItems}
              onRefresh={() => { checkSyncStatus(); loadJobs(tech.id); }}
              onError={showToast}
            />
          ))}
        </div>
        )}
      </main>

      {showStuckPanel && stuckOps.length > 0 && (
        <StuckOpsPanel
          stuckOps={stuckOps}
          jobs={jobs}
          onClose={() => setShowStuckPanel(false)}
          onResolved={(message) => {
            showToast(message);
            checkSyncStatus();
            if (tech) loadJobs(tech.id);
            getStuckOps().then((s) => { if (s.length === 0) setShowStuckPanel(false); });
          }}
          onError={showToast}
        />
      )}
    </div>
  );
}
