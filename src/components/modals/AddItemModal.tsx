"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { NewItemForm } from "@/types";

const BLANK: NewItemForm = {
  name: "",
  category: "",
  subCategory: "",
  defaultRate: "",
  isService: false,
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
      onSuccess(
        form.isService
          ? "Service added — it's billable on jobs now, with no stock to track."
          : "Catalog item registered and mapped to all storage locations!"
      );
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add catalog item");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Catalog Item" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-start gap-2 p-3 bg-zinc-50 border border-zinc-200 rounded cursor-pointer">
          <input
            type="checkbox"
            checked={form.isService}
            onChange={(e) => setForm((f) => ({ ...f, isService: e.target.checked }))}
            className="mt-0.5 accent-zinc-800"
          />
          <span className="text-xs text-zinc-700">
            <span className="font-semibold block">This is a service, not a physical part</span>
            Use this for labor-only billables (inspections, service calls, diagnostic fees). Services are
            never stock-tracked and completing a job never deducts them from van inventory.
          </span>
        </label>
        <Field label={form.isService ? "Service Name" : "Product / Material Name"}>
          <input
            required type="text"
            placeholder={form.isService ? "CCTV Inspection" : "Copper Pipe 3/4in 10ft"}
            value={form.name} onChange={set("name")} className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category (QB)">
            <input required type="text" placeholder={form.isService ? "Labor" : "Plumbing"} value={form.category} onChange={set("category")} className={inputCls} />
          </Field>
          <Field label="Sub-Category (QB)">
            <input required type="text" placeholder={form.isService ? "Service Call" : "Pipes"} value={form.subCategory} onChange={set("subCategory")} className={inputCls} />
          </Field>
        </div>
        <Field label="Default Billed Rate ($)">
          <input required type="number" step="0.01" min="0" placeholder="25.50" value={form.defaultRate} onChange={set("defaultRate")} className={inputCls} />
        </Field>
        <SubmitButton label={form.isService ? "Add Service" : "Add Catalog Product"} />
      </form>
    </Modal>
  );
}
