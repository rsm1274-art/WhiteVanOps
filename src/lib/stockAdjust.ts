/**
 * Pure helpers shared by the bulk stock-adjustment modal and the
 * `adjust_stock_bulk` branch of /api/inventory.
 *
 * Deliberately free of any DB or React import so both consumers — and the unit
 * tests — can use the same validation rules. The client uses them to decide
 * which rows actually changed; the server re-runs the same normalisation on the
 * wire payload, because a client-side check is a convenience, never a control.
 */

export interface StockValues {
  quantity: number;
  minThreshold: number;
}

/** Raw input strings as typed into the modal's number fields. */
export interface StockFormValues {
  quantity: string;
  minThreshold: string;
}

export interface StockAdjustment extends StockValues {
  stockLocationId: string;
}

/** A location the user never stocked reads as zero-on-hand, zero-threshold. */
export const EMPTY_STOCK: StockValues = { quantity: 0, minThreshold: 0 };

/**
 * Accepts a non-negative whole number written as a string or a number.
 * Returns null for anything else — blanks, decimals, negatives, "12abc", NaN.
 */
export function parseCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export type ChangedAdjustmentsResult =
  | { ok: true; adjustments: StockAdjustment[] }
  | { ok: false; invalidLocationIds: string[] };

/**
 * Reduce the modal's form state to just the rows whose quantity or minimum
 * differs from what the database currently holds. Locations absent from
 * `baseline` are compared against {@link EMPTY_STOCK}, so typing a count into a
 * location that has never held the item registers as a change.
 *
 * Reports every invalid field at once rather than stopping at the first, so the
 * user can fix a whole column in one pass.
 */
export function collectChangedAdjustments(
  baseline: Readonly<Record<string, StockValues>>,
  form: Readonly<Record<string, StockFormValues>>,
): ChangedAdjustmentsResult {
  const invalidLocationIds: string[] = [];
  const adjustments: StockAdjustment[] = [];

  for (const [stockLocationId, entered] of Object.entries(form)) {
    const quantity = parseCount(entered.quantity);
    const minThreshold = parseCount(entered.minThreshold);

    if (quantity === null || minThreshold === null) {
      invalidLocationIds.push(stockLocationId);
      continue;
    }

    const current = baseline[stockLocationId] ?? EMPTY_STOCK;
    if (quantity === current.quantity && minThreshold === current.minThreshold) continue;

    adjustments.push({ stockLocationId, quantity, minThreshold });
  }

  if (invalidLocationIds.length > 0) return { ok: false, invalidLocationIds };
  return { ok: true, adjustments };
}

export type NormalizeResult =
  | { ok: true; adjustments: StockAdjustment[] }
  | { ok: false; error: string };

/**
 * Server-side validation of an `adjust_stock_bulk` payload. Runs to completion
 * before any write is attempted so a bad row can never leave a half-applied
 * count behind.
 */
export function normalizeAdjustments(raw: unknown): NormalizeResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "No stock adjustments were supplied" };
  }

  const seen = new Set<string>();
  const adjustments: StockAdjustment[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "Malformed stock adjustment entry" };
    }

    const { stockLocationId, quantity, minThreshold } = entry as Record<string, unknown>;

    if (typeof stockLocationId !== "string" || stockLocationId.trim() === "") {
      return { ok: false, error: "Every adjustment must name a stock location" };
    }
    if (seen.has(stockLocationId)) {
      return { ok: false, error: "The same location appears twice in one adjustment" };
    }
    seen.add(stockLocationId);

    const parsedQty = parseCount(quantity);
    if (parsedQty === null) {
      return { ok: false, error: "Quantities must be whole numbers of zero or more" };
    }

    const parsedMin = parseCount(minThreshold);
    if (parsedMin === null) {
      return { ok: false, error: "Minimum levels must be whole numbers of zero or more" };
    }

    adjustments.push({ stockLocationId, quantity: parsedQty, minThreshold: parsedMin });
  }

  return { ok: true, adjustments };
}
