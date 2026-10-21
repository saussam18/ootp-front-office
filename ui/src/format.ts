import type { Fmt } from "./api";

/** OOTP writes some names in capitals ("FERNANDO JIMÉNEZ"); show every name the same way. */
export function displayName(name: string): string {
  if (!name || name !== name.toUpperCase() || name === name.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-'.(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/\bMc(\p{L})/gu, (_, c: string) => "Mc" + c.toUpperCase());
}

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function money(v: unknown, digits = 1): string {
  return isNum(v) ? `$${v.toFixed(digits)}M` : "–";
}

export function num(v: unknown, digits = 1): string {
  return isNum(v) ? v.toFixed(digits) : "–";
}

export function signed(v: unknown, digits = 1): string {
  return isNum(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}` : "–";
}

export function cell(v: unknown, fmt: Fmt): string {
  if (v === null || v === undefined || v === "") return "";
  switch (fmt) {
    case "money": return isNum(v) ? v.toFixed(1) : String(v);
    case "pct": return isNum(v) ? `${Math.round(v * 100)}%` : String(v);
    case "int": return isNum(v) ? v.toFixed(0) : String(v);
    case "num": return isNum(v) ? v.toFixed(2) : String(v);
    case "bool": return v ? "✓" : "";
    default: return String(v);
  }
}
