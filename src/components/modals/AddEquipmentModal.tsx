"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { NewEquipmentForm } from "@/types";

const BLANK: NewEquipmentForm = {
  name: "",
  serialNumber: "",
  status: "Active",
};

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddEquipmentModal({ onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewEquipmentForm>(BLANK);

  const set = (k: keyof NewEquipmentForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: k === "serialNumber" ? e.target.value.toUpperCase() : e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add equipment");
      onSuccess("Specialized equipment added to registry!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add equipment");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Specialized Tool" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Equipment / Tool Name">
          <input required type="text" placeholder="Honda EU2200i Generator" value={form.name} onChange={set("name")} className={inputCls} />
        </Field>
        <Field label="Serial Number (Unique)">
          <input required type="text" placeholder="SN-HD2200-55421" value={form.serialNumber} onChange={set("serialNumber")} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Asset Status">
          <select value={form.status} onChange={set("status")} className={selectCls}>
            <option value="Active">Active (Available)</option>
            <option value="In Use">In Use (Deployed)</option>
            <option value="Maintenance">Maintenance</option>
          </select>
        </Field>
        <SubmitButton label="Register Tool Asset" />
      </form>
    </Modal>
  );
}
