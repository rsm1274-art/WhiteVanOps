"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { AdjustedStockForm, AdjustStockContext } from "@/types";

interface Props {
  context: AdjustStockContext;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AdjustStockModal({ context, onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<AdjustedStockForm>({
    quantity: context.currentQty.toString(),
    minThreshold: context.currentMin.toString(),
  });

  const set = (k: keyof AdjustedStockForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust_stock",
          inventoryItemId: context.itemId,
          stockLocationId: context.locationId,
          quantity: form.quantity,
          minThreshold: form.minThreshold,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to adjust stock");
      onSuccess("Stock details updated!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to adjust stock");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Adjust Stock Count" onClose={onClose} />
      <div className="text-xs p-3 bg-zinc-50 border border-zinc-200 rounded">
        <p className="font-semibold text-zinc-700">{context.itemName}</p>
        <p className="text-zinc-500 mt-1">Location: {context.locationName}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Current Stock Quantity">
          <input required type="number" min="0" placeholder="15" value={form.quantity} onChange={set("quantity")} className={inputCls} />
        </Field>
        <Field label="Minimum Reorder Warning Level">
          <input required type="number" min="0" placeholder="5" value={form.minThreshold} onChange={set("minThreshold")} className={inputCls} />
        </Field>
        <SubmitButton label="Save Stock Levels" />
      </form>
    </Modal>
  );
}
