// Named, deterministic value transforms for the import pipeline.
export type TransformName = "date-iso" | "date-mdy" | "date-dmy" | "currency" | "int";
export const TRANSFORM_NAMES: TransformName[] = ["date-iso", "date-mdy", "date-dmy", "currency", "int"];

export type TransformResult = { ok: true; value: string } | { ok: false; reason: string };

const ok = (value: string): TransformResult => ({ ok: true, value });
const fail = (reason: string): TransformResult => ({ ok: false, reason });

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SLASH_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

export function applyTransform(name: TransformName, raw: string): TransformResult {
  const v = collapseWhitespace(raw);
  switch (name) {
    case "date-iso": {
      const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return fail(`"${v}" is not an ISO date (YYYY-MM-DD)`);
      return toYmd(+m[1], +m[2], +m[3], v);
    }
    case "date-mdy": {
      const m = v.match(SLASH_DATE);
      if (!m) return fail(`"${v}" is not a M/D/Y date`);
      return toYmd(expandYear(+m[3]), +m[1], +m[2], v);
    }
    case "date-dmy": {
      const m = v.match(SLASH_DATE);
      if (!m) return fail(`"${v}" is not a D/M/Y date`);
      return toYmd(expandYear(+m[3]), +m[2], +m[1], v);
    }
    case "currency": {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (v === "" || !Number.isFinite(n)) return fail(`"${v}" is not a currency amount`);
      return ok(String(n));
    }
    case "int": {
      const n = Number(v.replace(/,/g, ""));
      if (v === "" || !Number.isInteger(n)) return fail(`"${v}" is not a whole number`);
      return ok(String(n));
    }
  }
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function toYmd(y: number, mo: number, d: number, raw: string): TransformResult {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return fail(`"${raw}" is not a real calendar date`);
  }
  return ok(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

export function applyValueMap(
  valueMaps: Record<string, Record<string, string>> | undefined,
  target: string,
  value: string
): string {
  return valueMaps?.[target]?.[value] ?? value;
}
