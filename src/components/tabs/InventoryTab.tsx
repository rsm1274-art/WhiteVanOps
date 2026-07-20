"use client";

import { Plus, ArrowLeftRight } from "lucide-react";
import { DashboardData, StockLevel } from "@/types";
import { AdjustStockContext } from "@/types";

interface RemoveStockContext {
  itemId: string;
  locationId: string;
  itemName: string;
  locationName: string;
}

interface Props {
  data: DashboardData;
  onAddItem: () => void;
  onAddWarehouse: () => void;
  onTransferStock: () => void;
  onAdjustStock: (context: AdjustStockContext) => void;
  onRemoveStock: (context: RemoveStockContext) => void;
  onDeleteItem: (itemId: string, itemName: string) => void;
  onDeleteLocation: (locationId: string, locationName: string) => void;
}

export default function InventoryTab({ data, onAddItem, onAddWarehouse, onTransferStock, onAdjustStock, onRemoveStock, onDeleteItem, onDeleteLocation }: Props) {
  const { inventoryItems, stockLocations } = data;

  // Build lookup: itemId -> locationId -> StockLevel
  const stockMap = new Map<string, Map<string, StockLevel>>();
  for (const loc of stockLocations) {
    for (const level of loc.stockLevels) {
      if (!stockMap.has(level.inventoryItemId)) {
        stockMap.set(level.inventoryItemId, new Map());
      }
      stockMap.get(level.inventoryItemId)!.set(loc.id, level);
    }
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Warehouse & Van Inventory</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Master catalog with totals across all locations, plus per-location breakdowns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTransferStock}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 text-zinc-700 hover:bg-zinc-100 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Transfer Stock
          </button>
          <button
            onClick={onAddItem}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Catalog Product
          </button>
        </div>
      </div>

      {/* ── Master catalog table ── */}
      <section>
        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-3">
          Master Catalog — All Locations
        </h4>

        {inventoryItems.length === 0 ? (
          <p className="text-sm text-zinc-400">No catalog items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-100 text-zinc-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2 font-semibold">Item</th>
                  <th className="text-left px-3 py-2 font-semibold">Category</th>
                  <th className="text-center px-3 py-2 font-semibold">Total In Stock</th>
                  {stockLocations.map((loc) => (
                    <th key={loc.id} className="text-center px-3 py-2 font-semibold whitespace-nowrap">
                      {loc.name}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item, i) => {
                  const locMap = stockMap.get(item.id);
                  const total = locMap
                    ? Array.from(locMap.values()).reduce((sum, l) => sum + l.quantity, 0)
                    : 0;
                  const anyLow = locMap
                    ? Array.from(locMap.values()).some((l) => l.quantity <= l.minThreshold && l.minThreshold > 0)
                    : false;

                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-zinc-100 ${i % 2 === 0 ? "bg-white" : "bg-zinc-50"}`}
                    >
                      <td className="px-3 py-2.5 font-medium text-zinc-800">{item.name}</td>
                      <td className="px-3 py-2.5 text-zinc-500">
                        {item.category}
                        {item.subCategory ? <span className="text-zinc-400"> / {item.subCategory}</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-mono font-bold ${anyLow ? "text-red-600" : "text-zinc-900"}`}>
                          {total}
                        </span>
                        {anyLow && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-red-500">Low</span>
                        )}
                      </td>
                      {stockLocations.map((loc) => {
                        const level = locMap?.get(loc.id);
                        if (!level) {
                          return (
                            <td key={loc.id} className="px-3 py-2.5 text-center text-zinc-300 font-mono">
                              —
                            </td>
                          );
                        }
                        const isLow = level.quantity <= level.minThreshold && level.minThreshold > 0;
                        return (
                          <td key={loc.id} className="px-3 py-2.5 text-center">
                            <span className={`font-mono font-bold ${isLow ? "text-red-600" : "text-zinc-700"}`}>
                              {level.quantity}
                            </span>
                            {isLow && (
                              <span className="block text-[9px] font-bold uppercase text-red-400">Low</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => onDeleteItem(item.id, item.name)}
                          className="px-2 py-1 border border-red-200 text-red-400 hover:bg-red-50 rounded text-[10px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Per-location cards ── */}
      <section>
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
            By Location
          </h4>
          <button
            onClick={onAddWarehouse}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-300 text-zinc-700 hover:bg-zinc-100 text-[10px] font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add Warehouse
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stockLocations.length === 0 ? (
            <p className="text-sm text-zinc-500 col-span-3">No stock locations configured.</p>
          ) : (
            stockLocations.map((loc) => (
              <div key={loc.id} className="bg-white border border-zinc-200 rounded p-6 flex flex-col">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3 mb-4">
                  <div>
                    <h4 className="font-bold text-sm text-zinc-800">{loc.name}</h4>
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
                      Type: {loc.type}
                    </span>
                  </div>
                  {loc.type === "Vehicle" && loc.vehicle && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-zinc-100 px-2 py-0.5 rounded">
                      {loc.vehicle.make} {loc.vehicle.model}
                    </span>
                  )}
                  {loc.type === "Warehouse" && (
                    <button
                      onClick={() => onDeleteLocation(loc.id, loc.name)}
                      className="px-2 py-1 border border-red-200 text-red-400 hover:bg-red-50 rounded text-[10px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap"
                    >
                      Delete
                    </button>
                  )}
                </div>

                <div className="space-y-3 flex-1">
                  {loc.stockLevels.length === 0 ? (
                    <p className="text-xs text-zinc-400 py-2">No inventory loaded at this location.</p>
                  ) : (
                    loc.stockLevels.map((level: StockLevel) => {
                      const isLow = level.quantity <= level.minThreshold;
                      return (
                        <div
                          key={level.id}
                          className="text-xs pb-3 border-b border-zinc-100 last:border-0"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <span className="font-medium text-zinc-700 break-words">{level.inventoryItem.name}</span>
                              <span className="text-[9px] text-zinc-400 block">{level.inventoryItem.category}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`font-mono font-bold ${isLow ? "text-red-600" : "text-zinc-900"}`}>
                                {level.quantity}
                              </span>
                              <span className="text-zinc-400 text-[10px]"> / min {level.minThreshold}</span>
                              {isLow && (
                                <span className="block text-[9px] font-bold uppercase text-red-500">
                                  Low Stock
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              onClick={() =>
                                onAdjustStock({
                                  itemId: level.inventoryItem.id,
                                  locationId: loc.id,
                                  itemName: level.inventoryItem.name,
                                  locationName: loc.name,
                                  currentQty: level.quantity,
                                  currentMin: level.minThreshold,
                                })
                              }
                              className="px-2 py-1 border border-zinc-300 text-zinc-500 hover:bg-zinc-100 rounded text-[10px] font-bold uppercase tracking-wide transition-colors"
                            >
                              Adjust
                            </button>
                            <button
                              onClick={() =>
                                onRemoveStock({
                                  itemId: level.inventoryItem.id,
                                  locationId: loc.id,
                                  itemName: level.inventoryItem.name,
                                  locationName: loc.name,
                                })
                              }
                              className="px-2 py-1 border border-red-200 text-red-400 hover:bg-red-50 rounded text-[10px] font-bold uppercase tracking-wide transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
