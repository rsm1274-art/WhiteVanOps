"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { NewPersonnelForm } from "@/types";

const BLANK: NewPersonnelForm = {
  firstName: "",
  lastName: "",
  role: "Technician",
  certifications: "",
};

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddPersonnelModal({ onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewPersonnelForm>(BLANK);

  const set = (k: keyof NewPersonnelForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create employee");
      onSuccess("Employee details saved!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create employee");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Crew Member" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First Name">
            <input required type="text" placeholder="Dave" value={form.firstName} onChange={set("firstName")} className={inputCls} />
          </Field>
          <Field label="Last Name">
            <input required type="text" placeholder="Grohl" value={form.lastName} onChange={set("lastName")} className={inputCls} />
          </Field>
        </div>
        <Field label="Operational Role">
          <select value={form.role} onChange={set("role")} className={selectCls}>
            <option value="Technician">Technician (Field crew)</option>
            <option value="Dispatcher">Dispatcher (Office admin)</option>
          </select>
        </Field>
        <Field label="Certifications / Notes">
          <input type="text" placeholder="OSHA 10, EPA 608, Electrical HVAC" value={form.certifications} onChange={set("certifications")} className={inputCls} />
        </Field>
        <SubmitButton label="Register Employee" />
      </form>
    </Modal>
  );
}
