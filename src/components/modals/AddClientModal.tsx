"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { NewClientForm } from "@/types";

const BLANK: NewClientForm = {
  name: "",
  contactName: "",
  locationAddress: "",
  paymentTerms: "Net 30",
};

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddClientModal({ onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewClientForm>(BLANK);

  const set = (k: keyof NewClientForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create client");
      onSuccess("Client registered successfully!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create client");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add New Client Account" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Business or Client Name">
          <input required type="text" placeholder="Apex Solutions Ltd" value={form.name} onChange={set("name")} className={inputCls} />
        </Field>
        <Field label="Contact Person Name">
          <input required type="text" placeholder="John Miller" value={form.contactName} onChange={set("contactName")} className={inputCls} />
        </Field>
        <Field label="Location Address">
          <input required type="text" placeholder="100 Main St, Chicago IL 60601" value={form.locationAddress} onChange={set("locationAddress")} className={inputCls} />
        </Field>
        <Field label="QuickBooks Invoice Payment Terms">
          <select value={form.paymentTerms} onChange={set("paymentTerms")} className={selectCls}>
            <option value="Net 30">Net 30 (Due in 30 Days)</option>
            <option value="Net 15">Net 15 (Due in 15 Days)</option>
            <option value="Due on Receipt">Due on Receipt</option>
          </select>
        </Field>
        <SubmitButton label="Create Client Profile" />
      </form>
    </Modal>
  );
}
