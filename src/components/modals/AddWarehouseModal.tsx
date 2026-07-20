"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";

interface Props {
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddWarehouseModal({ onClose, onSuccess, onError }: Props) {
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_location", name }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add warehouse");
      onSuccess("Warehouse added and mapped to all catalog items!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add warehouse");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Warehouse Location" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Warehouse Name">
          <input
            required
            type="text"
            placeholder="Main Warehouse"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <p className="text-xs text-zinc-500">
          Every existing catalog item is added to this location at zero stock. Use Adjust on the
          location card to set counts.
        </p>
        <SubmitButton label="Add Warehouse" />
      </form>
    </Modal>
  );
}
