"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { NewMaintenanceForm, Vehicle } from "@/types";

const BLANK: NewMaintenanceForm = {
  date: "",
  cost: "",
  description: "",
  odometer: "",
};

interface Props {
  vehicle: Vehicle;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddMaintenanceModal({ vehicle, onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewMaintenanceForm>(BLANK);

  const set = (k: keyof NewMaintenanceForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_maintenance", vehicleId: vehicle.id, ...form }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save maintenance record");
      onSuccess("Maintenance log created.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save maintenance record");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title="Add Vehicle Service Record"
        subtitle={`${vehicle.make} ${vehicle.model} — VIN: ${vehicle.vin}`}
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Service Date">
            <input required type="date" value={form.date} onChange={set("date")} className={inputCls} />
          </Field>
          <Field label="Service Cost ($)">
            <input required type="number" step="0.01" min="0" placeholder="150.00" value={form.cost} onChange={set("cost")} className={inputCls} />
          </Field>
        </div>
        <Field label="Odometer Reading (mi)">
          <input required type="number" min="0" placeholder="45000" value={form.odometer} onChange={set("odometer")} className={inputCls} />
        </Field>
        <Field label="Description of Service">
          <textarea
            required
            rows={3}
            placeholder="Oil change, tire rotation, replacement of front brake pads..."
            value={form.description}
            onChange={set("description")}
            className={`${inputCls} resize-none`}
          />
        </Field>
        <SubmitButton label="Add Maintenance Log" />
      </form>
    </Modal>
  );
}
