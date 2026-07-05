// Natural-key helpers shared by resolve and execute.
import { ENTITY_META, type EntityName } from "./mappingSchema";

export function normKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

// Only reads `data`, never `refs` — fine for entities like StockLevel whose
// natural key fields are FK-based (they live in `refs`, not `data`) because
// nothing ever resolves to StockLevel as a target.
export function naturalKeyOf(entity: EntityName, data: Record<string, unknown>): string | null {
  const nk = ENTITY_META[entity].naturalKey;
  if (!nk) return null;
  return normKey(nk.map((f) => String(data[f] ?? "")).join(" "));
}

// Mirrors the create_vehicle action in src/app/api/fleet/route.ts
export function vehicleStockLocationName(model: string, vin: string): string {
  return `Van ${model} (${vin.substring(0, 4)}) Stock`;
}
