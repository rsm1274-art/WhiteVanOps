"use client";

import { useState, useRef } from "react";
import type { ReactNode, FormEvent } from "react";
import {
  Briefcase,
  Clock,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  MapPin,
  Truck,
  Users,
  Wrench,
  FileText,
  Package,
} from "lucide-react";
import { submitWrite } from "@/lib/offlineWrite";
import type { FieldJob, InventoryItem } from "@/app/field/page";

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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
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

  const handleSubmit = async (e: FormEvent) => {
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

  const handleSubmit = async (e: FormEvent) => {
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

  const handleSubmit = async (e: FormEvent) => {
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
export default function JobCard({
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
