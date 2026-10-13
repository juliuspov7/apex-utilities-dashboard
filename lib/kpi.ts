import type { Hotel, Row, Utility } from "./types";

export const UTILS: { key: Utility; label: string; unit: string }[] = [
  { key: "el", label: "Electricity", unit: "kWh" },
  { key: "cost", label: "Electricity cost", unit: "€" },
  { key: "heat", label: "Heating", unit: "kWh" },
  { key: "water", label: "Water", unit: "m³" },
];

export interface Agg {
  act: number | null;
  bud: number | null;
  /** actual / budget - 1 */
  dev: number | null;
  months: number;
}

export type Level = "none" | "ok" | "warn" | "alert";
export const WARN = 0.1;
export const ALERT = 0.2;

export function level(dev: number | null): Level {
  if (dev === null) return "none";
  if (dev >= ALERT) return "alert";
  if (dev >= WARN) return "warn";
  return "ok";
}

export function pick(r: Row, u: Utility): [number | null, number | null] {
  switch (u) {
    case "el": return [r.bad.includes("el") ? null : r.el, r.el_b];
    case "heat": return [r.bad.includes("heat") ? null : r.heat, r.heat_b];
    case "water": return [r.bad.includes("water") ? null : r.water, r.water_b];
    case "cost": return [r.cost, r.cost_b];
  }
}

/** Like-for-like: only months where both actual (valid) and budget exist are summed on both sides. */
export function aggregate(rows: Row[], u: Utility): Agg {
  let a = 0, b = 0, n = 0;
  for (const r of rows) {
    const [act, bud] = pick(r, u);
    if (act === null || bud === null || bud <= 0) continue;
    a += act; b += bud; n++;
  }
  return n === 0 ? { act: null, bud: null, dev: null, months: 0 } : { act: a, bud: b, dev: a / b - 1, months: n };
}

/** Intensity KPIs. Numerator and denominator only from months where both are valid. */
export function perRoom(rows: Row[], u: "el" | "heat" | "water"): number | null {
  let s = 0, o = 0;
  for (const r of rows) {
    const v = r[u];
    if (v === null || r.occ === null || r.bad.includes(u) || r.bad.includes("occ")) continue;
    s += v; o += r.occ;
  }
  return o > 0 ? s / o : null;
}

export function perM2(rows: Row[], hotels: Hotel[], u: "el" | "heat"): number | null {
  const gfa = new Map(hotels.map((h) => [h.id, h.gfa]));
  const sum = new Map<string, number>();
  for (const r of rows) {
    const v = r[u];
    if (v === null || r.bad.includes(u)) continue;
    sum.set(r.hotel, (sum.get(r.hotel) ?? 0) + v);
  }
  let s = 0, g = 0;
  for (const [h, v] of sum) { s += v; g += gfa.get(h) ?? 0; }
  return g > 0 ? s / g : null;
}

export const fmt = (v: number | null, d = 0) =>
  v === null ? "–" : v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtPct = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
export const fmtK = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v));
