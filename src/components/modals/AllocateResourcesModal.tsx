"use client";

import { useMemo, useState } from "react";
import Modal, { ModalHeader, Field } from "@/components/shared/Modal";
import { DashboardData, Job, JobPartLine, AddPartsContext } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";
import { findClientSideConflicts } from "@/lib/clientJobConflicts";

interface Props {
  context: AddPartsContext;
  data: DashboardData;
  job: Job;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function CheckboxList({
  items,
  selected,
  onChange,
  emptyLabel = "No equipment registered.",
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };
  return (
    <div className="border border-zinc-300 rounded divide-y divide-zinc-100 max-h-36 overflow-y-auto">
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 px-3 py-2">{emptyLabel}</p>
      ) : (
        items.map((item) => (
          <label key={item.id} className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() => toggle(item.id)}
              className="accent-zinc-800"
            />
            <span className="text-xs text-zinc-700">{item.label}</span>
          </label>
        ))
      )}
    </div>
  );
}

export default function AllocateResourcesModal({ context, data, job, onClose, onSuccess, onError }: Props) {
  const [parts, setParts] = useState<JobPartLine[]>(context.existingParts);
  const [eqIds, setEqIds] = useState<string[]>(context.existingEquipmentIds);
  const [personnelIds, setPersonnelIds] = useState<string[]>(job.assignments.map((a) => a.personnelId));

  // Completed jobs have locked crew server-side; reopen the job to change it.
  const isCompleted = job.status === "Completed";

  const warnings = useMemo(
    () =>
      findClientSideConflicts({
        data,
        scheduledDate: dateToLocalStr(job.scheduledDate),
        personnelIds,
        equipmentIds: eqIds,
        excludeJobId: job.id,
      }),
    [data, job.scheduledDate, job.id, eqIds, personnelIds]
  );

  const addLine = () =>
    setParts((p) => [...p, { inventoryItemId: "", quantity: 1, rate: 0, description: "" }]);

  const removeLine = (i: number) => setParts((p) => p.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof JobPartLine, value: string | number) =>
    setParts((p) => {
      const updated = [...p];
      if (field === "inventoryItemId" && typeof value === "string") {
        const item = data.inventoryItems.find((it) => it.id === value);
        updated[i] = { ...updated[i], inventoryItemId: value, rate: item ? item.defaultRate : updated[i].rate };
      } else {
        updated[i] = { ...updated[i], [field]: value };
      }
      return updated;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleted && personnelIds.length === 0) {
      onError("At least one technician must be assigned.");
      return;
    }
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: context.jobId,
          lineItems: parts,
          equipmentIds: eqIds,
          // Crew is locked once a job is Completed — omit it so the server
          // doesn't reject the materials/equipment save.
          ...(isCompleted ? {} : { personnelIds }),
        }),
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to save job allocations");
      }
      onSuccess("Job materials and equipment allocations saved.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save allocations");
    }
  };

  const eqItems = data.equipment.map((eq) => ({
    id: eq.id,
    label: `${eq.name} (S/N: ${eq.serialNumber})`,
  }));

  // Technicians, plus anyone already assigned (so a non-Technician assignee
  // stays visible and removable), mirroring EditJobModal's vehicle filter.
  const techItems = data.personnel
    .filter((p) => p.role === "Technician" || personnelIds.includes(p.id))
    .map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` }));

  return (
    <Modal onClose={onClose} maxWidth="xl">
      <ModalHeader
        title="Allocate Job Resources"
        subtitle={`Job #${job.id.substring(0, 8)} — ${job.client.name}`}
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Materials section */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-2">
            Materials & Catalog Parts
          </label>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {parts.map((item, i) => (
              <div key={i} className="flex gap-2 items-end border-b border-zinc-100 pb-2 last:border-0">
                <div className="flex-1">
                  <select
                    required
                    value={item.inventoryItemId}
                    onChange={(e) => updateLine(i, "inventoryItemId", e.target.value)}
                    className="w-full p-1.5 border border-zinc-300 text-xs bg-white rounded"
                  >
                    <option value="">-- Choose Part --</option>
                    {data.inventoryItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} (${it.defaultRate})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-16">
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateLine(i, "quantity", e.target.value)}
                    className="w-full p-1.5 border border-zinc-300 text-xs rounded"
                  />
                </div>
                <div className="w-20">
                  <input
                    required
                    type="number"
                    step="0.01"
                    placeholder="Rate"
                    value={item.rate}
                    onChange={(e) => updateLine(i, "rate", e.target.value)}
                    className="w-full p-1.5 border border-zinc-300 text-xs rounded"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Invoice notes..."
                    value={item.description}
                    onChange={(e) => updateLine(i, "description", e.target.value)}
                    className="w-full p-1.5 border border-zinc-300 text-xs rounded"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLine}
            className="mt-2 text-xs uppercase tracking-wider font-bold text-zinc-600 hover:text-zinc-900"
          >
            + Add Material Line
          </button>
        </div>

        {/* Crew section */}
        {isCompleted ? (
          <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-600">
            This job is Completed, so its crew is locked. Reopen the job to change assignments.
          </div>
        ) : (
          <Field label="Assign Crew">
            <CheckboxList
              items={techItems}
              selected={personnelIds}
              onChange={setPersonnelIds}
              emptyLabel="No technicians registered."
            />
          </Field>
        )}

        {/* Equipment section */}
        <Field label="Allocate Specialized Tools">
          <CheckboxList items={eqItems} selected={eqIds} onChange={setEqIds} />
        </Field>

        {warnings.length > 0 && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
            <p className="font-bold uppercase tracking-wider text-[10px]">Availability Conflict{warnings.length > 1 ? "s" : ""}</p>
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-zinc-100">
          <button
            type="submit"
            className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs uppercase tracking-wider font-bold rounded transition-colors"
          >
            Save Allocations
          </button>
        </div>
      </form>
    </Modal>
  );
}
