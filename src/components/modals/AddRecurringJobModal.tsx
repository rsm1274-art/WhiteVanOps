"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { DashboardData, NewRecurringJobForm, RecurringJobTemplate } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";

const BLANK: NewRecurringJobForm = {
  clientId: "",
  assignedVehicleId: "",
  notes: "",
  frequency: "Weekly",
  startDate: "",
  endDate: "",
  personnelIds: [],
  equipmentIds: [],
};

interface Props {
  data: DashboardData;
  template?: RecurringJobTemplate;
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

export default function AddRecurringJobModal({ data, template, onClose, onSuccess, onError }: Props) {
  const isEdit = !!template;
  const [form, setForm] = useState<NewRecurringJobForm>(
    template
      ? {
          clientId: template.clientId,
          assignedVehicleId: template.assignedVehicleId ?? "",
          notes: template.notes ?? "",
          frequency: template.frequency,
          startDate: dateToLocalStr(template.startDate),
          endDate: template.endDate ? dateToLocalStr(template.endDate) : "",
          personnelIds: template.personnel.map((p) => p.personnelId),
          equipmentIds: template.equipment.map((e) => e.equipmentId),
        }
      : BLANK
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.personnelIds.length === 0) {
      onError("At least one technician must be assigned.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/recurring-jobs", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: template!.id, ...form } : form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save recurring job");
      onSuccess(isEdit ? "Recurring job updated." : "Recurring job created.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save recurring job");
    } finally {
      setSaving(false);
    }
  };

  const techItems = data.personnel
    .filter((p) => p.role === "Technician")
    .map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}` }));

  const equipItems = data.equipment
    .filter((eq) => eq.status === "Active" || form.equipmentIds.includes(eq.id))
    .map((eq) => ({ id: eq.id, label: `${eq.name} (S/N: ${eq.serialNumber})` }));

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title={isEdit ? "Edit Recurring Job" : "New Recurring Job"}
        onClose={onClose}
      />
      <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-600">
        Defines a template. Use <span className="font-semibold text-zinc-700">Generate Jobs</span> on the recurring job row to create the next batch of real jobs from it — nothing is scheduled automatically.
      </div>
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
              .filter((v) => v.status === "Active" || v.id === form.assignedVehicleId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} ({v.vin.substring(0, 6)}...)
                </option>
              ))}
          </select>
        </Field>

        <Field label="Frequency">
          <select
            value={form.frequency}
            onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as NewRecurringJobForm["frequency"] }))}
            className={selectCls}
          >
            <option value="Weekly">Weekly</option>
            <option value="Biweekly">Biweekly</option>
            <option value="Monthly">Monthly</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="First Occurrence">
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className={inputCls}
            />
          </Field>
          <Field label="End Date (optional)">
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Scope of Work / Notes">
          <textarea
            rows={3}
            placeholder="Describe the recurring work — carried onto every generated job..."
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

        <SubmitButton label={saving ? "Saving…" : isEdit ? "Save Recurring Job" : "Create Recurring Job"} />
      </form>
    </Modal>
  );
}
