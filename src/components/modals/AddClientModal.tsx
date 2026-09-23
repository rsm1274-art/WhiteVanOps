"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { Client, NewClientForm } from "@/types";

const BLANK: NewClientForm = {
  name: "",
  contactName: "",
  contactPhone: "",
  locationAddress: "",
  paymentTerms: "Net 30",
};

interface Props {
  /** When set, the modal edits this client instead of creating a new one. */
  client?: Client;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddClientModal({ client, onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewClientForm>(
    client
      ? {
          name: client.name,
          contactName: client.contactName,
          contactPhone: client.contactPhone ?? "",
          locationAddress: client.locationAddress,
          paymentTerms: client.paymentTerms,
        }
      : BLANK
  );

  const set = (k: keyof NewClientForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/clients", {
        method: client ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(client ? { id: client.id, ...form } : form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save client");
      onSuccess(client ? "Client updated." : "Client registered successfully!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save client");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={client ? "Edit Client Account" : "Add New Client Account"} onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Business or Client Name">
          <input required type="text" placeholder="Apex Solutions Ltd" value={form.name} onChange={set("name")} className={inputCls} />
        </Field>
        <Field label="Contact Person Name">
          <input required type="text" placeholder="John Miller" value={form.contactName} onChange={set("contactName")} className={inputCls} />
        </Field>
        <Field label="Contact Phone (optional — tap-to-call for techs)">
          <input type="tel" placeholder="(312) 555-0142" value={form.contactPhone} onChange={set("contactPhone")} className={inputCls} />
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
        <SubmitButton label={client ? "Save Client" : "Create Client Profile"} />
      </form>
    </Modal>
  );
}
