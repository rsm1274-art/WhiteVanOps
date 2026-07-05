"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { NewVehicleForm } from "@/types";

const BLANK: NewVehicleForm = {
  vin: "",
  make: "",
  model: "",
  status: "Active",
};

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddVehicleModal({ onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewVehicleForm>(BLANK);

  const set = (k: keyof NewVehicleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: k === "vin" ? e.target.value.toUpperCase() : e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_vehicle", ...form }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create vehicle");
      onSuccess("Fleet vehicle and stock location registered!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create vehicle");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Fleet Vehicle" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="VIN (17 Characters)">
          <input required maxLength={17} type="text" placeholder="1FTFW1EF5GXXXXXXX" value={form.vin} onChange={set("vin")} className={`${inputCls} font-mono`} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Make">
            <input required type="text" placeholder="Ford" value={form.make} onChange={set("make")} className={inputCls} />
          </Field>
          <Field label="Model">
            <input required type="text" placeholder="Transit 250" value={form.model} onChange={set("model")} className={inputCls} />
          </Field>
        </div>
        <Field label="Fleet Status">
          <select value={form.status} onChange={set("status")} className={selectCls}>
            <option value="Active">Active (Available for Dispatch)</option>
            <option value="In Maintenance">In Maintenance (Locked)</option>
            <option value="Retired">Retired</option>
          </select>
        </Field>
        <SubmitButton label="Register Fleet Vehicle" />
      </form>
    </Modal>
  );
}
