"use client";

import { useMemo, useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { DashboardData, NewJobForm } from "@/types";
import { findClientSideConflicts } from "@/lib/clientJobConflicts";

const BLANK: NewJobForm = {
  clientId: "",
  assignedVehicleId: "",
  scheduledDate: "",
  notes: "",
  personnelIds: [],
  equipmentIds: [],
};

interface Props {
  data: DashboardData;
  initialValues?: Partial<NewJobForm>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function CheckboxList({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <Field label={label}>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 py-1">None available.</p>
      ) : (
        <div className="border border-zinc-300 rounded divide-y divide-zinc-100 max-h-40 overflow-y-auto">
          {items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
                className="accent-zinc-800"
              />
              <span className="text-xs text-zinc-700">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </Field>
  );
}

export default function AddJobModal({ data, initialValues, onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewJobForm>({ ...BLANK, ...initialValues });
  const isClone = !!initialValues;

  const warnings = useMemo(
    () =>
      findClientSideConflicts({
        data,
        scheduledDate: form.scheduledDate,
        assignedVehicleId: form.assignedVehicleId,
        personnelIds: form.personnelIds,
        equipmentIds: form.equipmentIds,
      }),
    [data, form.scheduledDate, form.assignedVehicleId, form.personnelIds, form.equipmentIds]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.personnelIds.length === 0) {
      onError("At least one technician must be assigned.");
      return;
    }
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create job");
      onSuccess(isClone ? "Job cloned and scheduled!" : "Job scheduled successfully!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create job");
    }
  };

  const techItems = data.personnel
    .filter((p) => p.role === "Technician")
    .map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` }));

  const equipItems = data.equipment
    .filter((eq) => eq.status === "Active")
    .map((eq) => ({ id: eq.id, label: `${eq.name} (S/N: ${eq.serialNumber})` }));

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title={isClone ? "Clone Job — Set New Date" : "Schedule Field Job"}
        onClose={onClose}
      />
      {isClone && (
        <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-600">
          Pre-filled from the original job. Change any fields as needed — only the date is required.
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Select Client">
          <select
            required
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
            className={selectCls}
          >
            <option value="">-- Choose Client --</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.paymentTerms})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Dispatch Fleet Vehicle (Van)">
          <select
            value={form.assignedVehicleId}
            onChange={(e) => setForm((f) => ({ ...f, assignedVehicleId: e.target.value }))}
            className={selectCls}
          >
            <option value="">-- No Vehicle (Standalone Service) --</option>
            {data.vehicles
              .filter((v) => v.status === "Active")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} ({v.vin.substring(0, 6)}...)
                </option>
              ))}
          </select>
        </Field>

        <Field label="Scheduled Date">
          <input
            required
            type="date"
            value={form.scheduledDate}
            onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
            className={inputCls}
          />
        </Field>

        <Field label="Scope of Work / Notes">
          <textarea
            rows={3}
            placeholder="Describe the work to be done, access instructions, special requirements..."
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className={`${inputCls} resize-none`}
          />
        </Field>

        <CheckboxList
          label="Assign Crew"
          items={techItems}
          selected={form.personnelIds}
          onChange={(ids) => setForm((f) => ({ ...f, personnelIds: ids }))}
        />

        <CheckboxList
          label="Allocate Specialized Tools"
          items={equipItems}
          selected={form.equipmentIds}
          onChange={(ids) => setForm((f) => ({ ...f, equipmentIds: ids }))}
        />

        {warnings.length > 0 && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
            <p className="font-bold uppercase tracking-wider text-[10px]">Availability Conflict{warnings.length > 1 ? "s" : ""}</p>
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <SubmitButton label={isClone ? "Schedule Cloned Job" : "Create Dispatch Assignment"} />
      </form>
    </Modal>
  );
}
