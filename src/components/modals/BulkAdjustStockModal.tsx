"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Modal, { ModalHeader, inputCls, selectCls } from "@/components/shared/Modal";
import { InventoryItem, StockLocation } from "@/types";
import {
  EMPTY_STOCK,
  StockFormValues,
  StockValues,
  collectChangedAdjustments,
} from "@/lib/stockAdjust";

interface Props {
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
}

/** Warehouses first, then vehicles — the order people count stock in. */
function orderLocations(locations: StockLocation[]): StockLocation[] {
  return [...locations].sort((a, b) => {
    if (a.type !== b.type) return a.type === "Warehouse" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const blankRow: StockFormValues = { quantity: "0", minThreshold: "0" };

export default function BulkAdjustStockModal({ items, locations, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const [itemId, setItemId] = useState("");
  const [form, setForm] = useState<Record<string, StockFormValues>>({});
  const [invalidIds, setInvalidIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Reported inside the modal rather than through the dashboard toast: that
  // toast renders in the page flow behind this modal's overlay, so an error
  // raised here would land where the user is not looking.
  const [error, setError] = useState<string | null>(null);

  // The dashboard only reloads when this modal closes, so `locations` is a
  // snapshot from when it opened. Anything saved during this session is
  // remembered here and preferred over that stale snapshot, so returning to an
  // item a second time shows the counts you just entered, not the old ones.
  const [savedInSession, setSavedInSession] = useState<Record<string, Record<string, StockValues>>>({});

  const orderedLocations = useMemo(() => orderLocations(locations), [locations]);

  const visibleItems = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return sorted;
    return sorted.filter(
      (i) =>
        i.name.toLowerCase().includes(needle) ||
        i.category.toLowerCase().includes(needle) ||
        i.subCategory.toLowerCase().includes(needle)
    );
  }, [items, filter]);

  const selectedItem = items.find((i) => i.id === itemId) ?? null;

  /** Current DB state for the chosen item, session saves taking precedence. */
  const baselineFor = (id: string): Record<string, StockValues> => {
    const baseline: Record<string, StockValues> = {};
    for (const loc of locations) {
      const level = loc.stockLevels.find((l) => l.inventoryItemId === id);
      if (level) {
        baseline[loc.id] = { quantity: level.quantity, minThreshold: level.minThreshold };
      }
    }
    return { ...baseline, ...(savedInSession[id] ?? {}) };
  };

  const handlePickItem = (id: string) => {
    setItemId(id);
    setInvalidIds([]);
    setConfirmation(null);
    setError(null);

    if (!id) {
      setForm({});
      return;
    }

    const baseline = baselineFor(id);
    const next: Record<string, StockFormValues> = {};
    for (const loc of orderedLocations) {
      const current = baseline[loc.id] ?? EMPTY_STOCK;
      next[loc.id] = {
        quantity: current.quantity.toString(),
        minThreshold: current.minThreshold.toString(),
      };
    }
    setForm(next);
  };

  const setCell = (locationId: string, field: keyof StockFormValues, value: string) => {
    setForm((f) => ({
      ...f,
      [locationId]: { ...(f[locationId] ?? blankRow), [field]: value },
    }));
    setInvalidIds((ids) => ids.filter((id) => id !== locationId));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || saving) return;

    const baseline = baselineFor(selectedItem.id);
    const diff = collectChangedAdjustments(baseline, form);

    if (!diff.ok) {
      setInvalidIds(diff.invalidLocationIds);
      setConfirmation(null);
      setError("Every count must be a whole number of zero or more.");
      return;
    }
    if (diff.adjustments.length === 0) {
      setConfirmation(null);
      setError("Nothing changed — adjust a count before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust_stock_bulk",
          inventoryItemId: selectedItem.id,
          adjustments: diff.adjustments,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to adjust stock");

      // Record what we just wrote so a second pass at this item starts from the
      // new numbers, then clear the picker so the next item can be chosen.
      const applied: Record<string, StockValues> = { ...(savedInSession[selectedItem.id] ?? {}) };
      for (const adj of diff.adjustments) {
        applied[adj.stockLocationId] = {
          quantity: adj.quantity,
          minThreshold: adj.minThreshold,
        };
      }
      setSavedInSession((s) => ({ ...s, [selectedItem.id]: applied }));

      const count = diff.adjustments.length;
      setConfirmation(
        `Saved — ${selectedItem.name} updated at ${count} location${count === 1 ? "" : "s"}.`
      );
      setItemId("");
      setForm({});
      setInvalidIds([]);
    } catch (err: unknown) {
      // Values are left in the grid so nothing has to be retyped on a retry.
      setError(err instanceof Error ? err.message : "Failed to adjust stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="xl">
      <ModalHeader
        title="Inventory Adjustment"
        subtitle="Set counts for one item across every location"
        onClose={onClose}
      />

      {confirmation && (
        <div
          role="status"
          className="text-xs p-3 bg-green-50 border border-green-300 text-green-800 rounded font-semibold"
        >
          {confirmation}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="text-xs p-3 bg-red-50 border border-red-300 text-red-800 rounded font-semibold"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="bulk-adjust-filter"
            className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
          >
            Find Item
          </label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="bulk-adjust-filter"
              type="text"
              placeholder="Filter by name, category or sub-category"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={`${inputCls} w-full pl-8`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="bulk-adjust-item"
            className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
          >
            Inventory Item
          </label>
          <select
            id="bulk-adjust-item"
            value={itemId}
            onChange={(e) => handlePickItem(e.target.value)}
            className={`${selectCls} w-full`}
          >
            <option value="">
              {visibleItems.length === 0 ? "No items match that filter" : "Select an item…"}
            </option>
            {visibleItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.category}
              </option>
            ))}
          </select>
        </div>

        {selectedItem && (
          <>
            <div className="border border-zinc-200 rounded overflow-hidden">
              <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 px-3 py-2 bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <span>Location</span>
                <span className="text-center">Qty</span>
                <span className="text-center">Min</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-zinc-100">
                {orderedLocations.length === 0 ? (
                  <p className="text-xs text-zinc-500 px-3 py-4">
                    No stock locations configured. Add a warehouse or a vehicle first.
                  </p>
                ) : (
                  orderedLocations.map((loc) => {
                    const row = form[loc.id] ?? blankRow;
                    const isInvalid = invalidIds.includes(loc.id);
                    const cellCls = `${inputCls} w-full text-center font-mono ${
                      isInvalid ? "border-red-500 ring-1 ring-red-500" : ""
                    }`;
                    return (
                      <div
                        key={loc.id}
                        className="grid grid-cols-[1fr_5rem_5rem] gap-2 px-3 py-2 items-center"
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-zinc-800 break-words">
                            {loc.name}
                          </span>
                          <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                            {loc.type}
                            {loc.type === "Vehicle" && loc.vehicle
                              ? ` · ${loc.vehicle.make} ${loc.vehicle.model}`
                              : ""}
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          aria-label={`Quantity at ${loc.name}`}
                          aria-invalid={isInvalid}
                          value={row.quantity}
                          onChange={(e) => setCell(loc.id, "quantity", e.target.value)}
                          className={cellCls}
                        />
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          aria-label={`Minimum level at ${loc.name}`}
                          aria-invalid={isInvalid}
                          value={row.minThreshold}
                          onChange={(e) => setCell(loc.id, "minThreshold", e.target.value)}
                          className={cellCls}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <p className="text-[10px] text-zinc-400">
              Only the rows you change are written. Min is the level at which the item is
              flagged as low stock; leave it at 0 for no warning.
            </p>
          </>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={!selectedItem || saving}
            className="flex-1 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-wider rounded transition-colors"
          >
            {saving ? "Saving…" : "Save & Adjust Another"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 border border-zinc-300 text-zinc-700 hover:bg-zinc-100 font-bold text-xs uppercase tracking-wider rounded transition-colors"
          >
            Done
          </button>
        </div>
      </form>
    </Modal>
  );
}
