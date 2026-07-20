"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls } from "@/components/shared/Modal";
import { InventoryItem, StockLocation } from "@/types";

interface Props {
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function TransferStockModal({ items, locations, onClose, onSuccess, onError }: Props) {
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [quantity, setQuantity] = useState("");

  const onHandAt = (locationId: string): number => {
    const loc = locations.find((l) => l.id === locationId);
    const level = loc?.stockLevels.find((sl) => sl.inventoryItemId === itemId);
    return level?.quantity ?? 0;
  };

  const sourceOnHand = fromId ? onHandAt(fromId) : null;
  const qtyNum = parseInt(quantity, 10);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const overDraw = sourceOnHand !== null && qtyValid && qtyNum > sourceOnHand;
  const sameLocation = fromId !== "" && fromId === toId;

  const canSubmit =
    itemId !== "" && fromId !== "" && toId !== "" && !sameLocation && qtyValid && !overDraw;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer_stock",
          inventoryItemId: itemId,
          fromLocationId: fromId,
          toLocationId: toId,
          quantity,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to transfer stock");
      onSuccess("Stock transferred.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to transfer stock");
    }
  };

  // A transfer needs at least two locations and one catalog item.
  if (locations.length < 2 || items.length === 0) {
    return (
      <Modal onClose={onClose}>
        <ModalHeader title="Transfer Stock" onClose={onClose} />
        <p className="text-sm text-zinc-600">
          {items.length === 0
            ? "Add at least one catalog item before transferring stock."
            : "You need at least two stock locations (e.g. a warehouse and a van) to transfer between. Add a warehouse or a vehicle first."}
        </p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Transfer Stock" subtitle="Move units between a warehouse and a van" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Item">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectCls}>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={selectCls}>
              <option value="">Select…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To">
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={selectCls}>
              <option value="">Select…</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {sourceOnHand !== null && (
          <p className="text-xs text-zinc-500">
            On hand at source: <span className="font-mono font-bold text-zinc-800">{sourceOnHand}</span>
          </p>
        )}

        <Field label="Quantity to Transfer">
          <input
            required
            type="number"
            min="1"
            step="1"
            placeholder="10"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputCls}
          />
        </Field>

        {sameLocation && (
          <p className="text-xs text-red-600">Source and destination must be different locations.</p>
        )}
        {overDraw && (
          <p className="text-xs text-red-600">
            Cannot transfer more than the {sourceOnHand} on hand at the source.
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs uppercase tracking-wider rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Transfer Stock
        </button>
      </form>
    </Modal>
  );
}
