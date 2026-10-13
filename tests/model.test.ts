// Run with: npm test   (Node's built-in test runner, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { build, parseWorkbook, type Parsed } from "../lib/model.ts";

const noPrices = { months: {}, status: "unavailable" as const, message: "", fetchedAt: null, now: null };
const prices = { months: { "2026-01": { lt: 100 } }, status: "live" as const, message: "", fetchedAt: null, now: null };

function base(): Parsed {
  return {
    hotels: [
      { id: "H01", name: "A", country: "RO", segment: "", rooms: 100, gfa: 5000, heating: "gas", contract: "Fixed" },
      { id: "H02", name: "B", country: "LT", segment: "", rooms: 100, gfa: 5000, heating: "dh", contract: "Spot" },
    ],
    tariffs: {
      RO: { type: "Fixed", fixed: 0.17, margin: 0, grid: 0, area: "" },
      LT: { type: "Spot", fixed: 0, margin: 0.0125, grid: 0.071, area: "lt" },
    },
    actuals: [
      { hotel_id: "H01", month: "2026-01", occupied_rooms: 2000, guests: 2600, electricity_kwh: 50000, heating_kwh: 40000, water_m3: 500 },
      { hotel_id: "H02", month: "2026-01", occupied_rooms: 2000, guests: 2600, electricity_kwh: 50000, heating_kwh: 40000, water_m3: 500 },
    ],
    budget: [
      { hotel_id: "H01", month: "2026-01", occupied_rooms_bu: 2000, electricity_kwh_bu: 50000, heating_kwh_bu: 40000, water_m3_bu: 500, electricity_cost_bu_eur: 8500 },
      { hotel_id: "H02", month: "2026-01", occupied_rooms_bu: 2000, electricity_kwh_bu: 50000, heating_kwh_bu: 40000, water_m3_bu: 500, electricity_cost_bu_eur: 9000 },
    ],
  };
}
const row = (r: ReturnType<typeof build>, h: string, m: string) => r.rows.find((x) => x.hotel === h && x.month === m)!;

test("clean data: fixed and spot cost are calculated", () => {
  const r = build(base(), prices);
  assert.equal(r.issues.filter((i) => i.action !== "info").length, 0);
  assert.ok(Math.abs(row(r, "H01", "2026-01").cost! - 50000 * 0.17) < 1e-6);
  // spot: 100 EUR/MWh -> 0.1 + margin 0.0125 + grid 0.071
  assert.ok(Math.abs(row(r, "H02", "2026-01").cost! - 50000 * (0.1 + 0.0125 + 0.071)) < 1e-6);
});

test("identical duplicate rows are counted once", () => {
  const p = base();
  p.actuals.push({ ...p.actuals[0] });
  const r = build(p, prices);
  assert.equal(r.rows.filter((x) => x.hotel === "H01").length, 1);
  assert.deepEqual(row(r, "H01", "2026-01").bad, []);
});

test("conflicting duplicate rows are excluded from every KPI", () => {
  const p = base();
  p.actuals.push({ ...p.actuals[0], electricity_kwh: 99999 });
  const r = build(p, prices);
  const x = row(r, "H01", "2026-01");
  assert.deepEqual([...x.bad].sort(), ["el", "heat", "occ", "water"]);
  assert.equal(x.cost, null);
  assert.ok(r.issues.some((i) => i.kind === "duplicate" && i.action === "excluded"));
});

test("missing budget does not break anything", () => {
  const p = base();
  p.budget = [];
  const r = build(p, prices);
  assert.equal(row(r, "H01", "2026-01").el_b, null);
  assert.ok(r.issues.some((i) => i.kind === "no budget"));
});

test("conflicting budget rows are skipped and reported", () => {
  const p = base();
  p.budget.push({ ...p.budget[0], electricity_kwh_bu: 1 });
  const r = build(p, prices);
  assert.equal(row(r, "H01", "2026-01").el_b, null);
  assert.ok(r.issues.some((i) => i.kind === "budget conflict"));
});

test("negative, zero, missing and unit-error values are excluded and explained", () => {
  const p = base();
  p.actuals[0].heating_kwh = -5;
  p.actuals[0].water_m3 = null;
  p.actuals[1].electricity_kwh = 72.4; // MWh typed as kWh
  const r = build(p, prices);
  assert.deepEqual([...row(r, "H01", "2026-01").bad].sort(), ["heat", "water"]);
  assert.deepEqual(row(r, "H02", "2026-01").bad, ["el"]);
  assert.equal(row(r, "H02", "2026-01").cost, null);
});

test("occupied rooms above physical capacity are excluded", () => {
  const p = base();
  p.actuals[0].occupied_rooms = 100 * 31 + 1;
  assert.ok(row(build(p, prices), "H01", "2026-01").bad.includes("occ"));
});

test("spot price unavailable: no crash, fixed hotels still priced, spot cost empty", () => {
  const r = build(base(), noPrices);
  assert.ok(row(r, "H01", "2026-01").cost !== null);
  assert.equal(row(r, "H02", "2026-01").cost, null);
  assert.equal(r.missingPrice, 1);
});

test("text numbers and alternative month/hotel formats are understood", () => {
  const p = base();
  p.actuals.push({ hotel_id: "Hotel 01", month: "02.2026", occupied_rooms: "1 900", guests: 2500, electricity_kwh: "48 000", heating_kwh: "39,5", water_m3: 480 });
  const r = build(p, prices);
  const x = row(r, "H01", "2026-02");
  assert.equal(x.occ, 1900);
  assert.equal(x.el, 48000);
  assert.equal(x.heat, 39.5);
});

test("an updated file with a new month shows that month and a correction replaces the old value", () => {
  const p = base();
  p.actuals[0].electricity_kwh = 51000; // correction
  p.actuals.push({ ...p.actuals[0], month: "2026-02" });
  const r = build(p, prices);
  assert.equal(r.latest, "2026-02");
  assert.equal(row(r, "H01", "2026-01").el, 51000);
});

test("a hotel that did not report the latest month is listed", () => {
  const p = base();
  p.actuals.push({ ...p.actuals[0], month: "2026-02" });
  const r = build(p, prices);
  assert.ok(r.issues.some((i) => i.hotel === "H02" && i.month === "2026-02" && i.kind === "missing report"));
});

test("spot tariff without a valid price area is reported", () => {
  const p = base();
  p.tariffs.LT.area = "";
  const r = build(p, prices);
  assert.ok(r.issues.some((i) => i.kind === "bad price area"));
});

test("invalid workbook is rejected with a clear message", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ a: 1 }]), "Hotels");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  assert.throws(() => parseWorkbook(buf), /missing column|is missing/);
});
