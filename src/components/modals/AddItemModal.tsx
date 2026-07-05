"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { NewItemForm } from "@/types";

const BLANK: NewItemForm = {
  name: "",
  category: "",
  subCategory: "",
  defaultRate: "",
};

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddItemModal({ onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewItemForm>(BLANK);

  const set = (k: keyof NewItemForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_item", ...form }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add catalog item");
      onSuccess("Catalog item registered and mapped to all storage locations!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add catalog item");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Catalog Material" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Product / Material Name">
          <input required type="text" placeholder="Copper Pipe 3/4in 10ft" value={form.name} onChange={set("name")} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category (QB)">
            <input required type="text" placeholder="Plumbing" value={form.category} onChange={set("category")} className={inputCls} />
          </Field>
          <Field label="Sub-Category (QB)">
            <input required type="text" placeholder="Pipes" value={form.subCategory} onChange={set("subCategory")} className={inputCls} />
          </Field>
        </div>
        <Field label="Default Billed Rate ($)">
          <input required type="number" step="0.01" min="0" placeholder="25.50" value={form.defaultRate} onChange={set("defaultRate")} className={inputCls} />
        </Field>
        <SubmitButton label="Add Catalog Product" />
      </form>
    </Modal>
  );
}
