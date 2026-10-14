import ExcelJS from "exceljs";
import type { Field, Hotel, Issue, Row } from "./types";
import type { PriceResult } from "./prices";

type Raw = Record<string, unknown>;

export interface Parsed {
  hotels: Hotel[];
  tariffs: Record<string, { type: "Fixed" | "Spot"; fixed: number; margin: number; grid: number; area: string }>;
  actuals: Raw[];
  budget: Raw[];
}

const REQUIRED: Record<string, string[]> = {
  Hotels: ["hotel_id", "hotel_name", "country", "rooms", "gfa_m2"],
  Tariffs: ["country", "contract_type", "grid_fee_eur_kwh"],
  Monthly_Actuals: ["hotel_id", "month", "occupied_rooms", "electricity_kwh", "heating_kwh", "water_m3"],
  Monthly_Budget: ["hotel_id", "month", "electricity_kwh_bu", "heating_kwh_bu", "water_m3_bu", "electricity_cost_bu_eur"],
};

export function normHotel(v: unknown): string | null {
  const m = String(v ?? "").match(/(\d+)/);
  return m ? "H" + m[1].padStart(2, "0") : null;
}

export function normMonth(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) {
    const d = new Date(+v + 12 * 3600e3);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400e3);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s ]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** One cell as a plain value: number, string, Date or null (formulas give their stored result). */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || v instanceof Date) return v;
  if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return v.text;
  return null; // error values such as #N/A
}

/** First row = headers, following rows = records (same shape as before); empty cells are null. */
function sheetRows(ws: ExcelJS.Worksheet): Raw[] {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => {
    const h = cellValue(c.value);
    if (h !== null && String(h) !== "") headers[i] = String(h);
  });
  const rows: Raw[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Raw = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cellValue(row.getCell(i).value);
      rec[h] = v;
      if (v !== null && v !== "") any = true;
    });
    if (any) rows.push(rec);
  }
  return rows;
}

export async function parseWorkbook(buf: Buffer): Promise<Parsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = (name: string): Raw[] => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Sheet "${name}" is missing`);
    const rows = sheetRows(ws);
    const cols = new Set(Object.keys(rows[0] ?? {}));
    const miss = REQUIRED[name].filter((c) => !cols.has(c));
    if (miss.length) throw new Error(`Sheet "${name}" is missing column(s): ${miss.join(", ")}`);
    return rows;
  };
  const tariffRows = sheet("Tariffs");
  const tariffs: Parsed["tariffs"] = {};
  for (const t of tariffRows) {
    tariffs[String(t.country).trim()] = {
      type: String(t.contract_type).trim().toLowerCase() === "spot" ? "Spot" : "Fixed",
      fixed: num(t.fixed_price_eur_kwh) ?? 0,
      margin: num(t.spot_margin_eur_kwh) ?? 0,
      grid: num(t.grid_fee_eur_kwh) ?? 0,
      area: String(t.price_area ?? "").trim().toLowerCase(),
    };
  }
  const hotels: Hotel[] = sheet("Hotels").flatMap((h) => {
    const id = normHotel(h.hotel_id);
    if (!id) return [];
    const country = String(h.country).trim();
    return [
      {
        id,
        name: String(h.hotel_name),
        country,
        segment: String(h.segment ?? ""),
        rooms: num(h.rooms) ?? 0,
        gfa: num(h.gfa_m2) ?? 0,
        heating: String(h.heating_source ?? ""),
        contract: tariffs[country]?.type ?? "Fixed",
      },
    ];
  });
  return { hotels, tariffs, actuals: sheet("Monthly_Actuals"), budget: sheet("Monthly_Budget") };
}

const FIELD_LABEL: Record<Field, string> = {
  occ: "occupied rooms",
  el: "electricity",
  heat: "heating",
  water: "water",
};

function daysIn(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function build(parsed: Parsed, prices: PriceResult) {
  const issues: Issue[] = [];
  const hotelById = new Map<string, Hotel>();
  for (const h of parsed.hotels) if (!hotelById.has(h.id)) hotelById.set(h.id, h);
  const add = (i: Issue) => issues.push(i);

  // ---- structural checks on master data
  const budgetCols = { electricity_kwh_bu: 1, heating_kwh_bu: 1, water_m3_bu: 1, electricity_cost_bu_eur: 1, occupied_rooms_bu: 1 };
  const seenHotel = new Set<string>();
  for (const h of parsed.hotels) {
    if (seenHotel.has(h.id)) add({ hotel: h.id, month: "-", field: "hotels", kind: "duplicate hotel", message: `Hotel ${h.id} is listed more than once in the Hotels sheet – first entry used`, action: "flagged" });
    seenHotel.add(h.id);
    const t = parsed.tariffs[h.country];
    if (!t) add({ hotel: h.id, month: "-", field: "tariff", kind: "no tariff", message: `No tariff row for country ${h.country} – electricity cost cannot be calculated`, action: "excluded" });
    else if (t.type === "Spot" && !["lt", "lv", "ee"].includes(t.area)) add({ hotel: h.id, month: "-", field: "tariff", kind: "bad price area", message: `Spot tariff for ${h.country} has price area "${t.area || "empty"}" (expected LT, LV or EE) – electricity cost cannot be calculated`, action: "excluded" });
  }

  // ---- budget lookup
  const budget = new Map<string, Raw>();
  const conflictBudget = new Set<string>();
  for (const b of parsed.budget) {
    const h = normHotel(b.hotel_id);
    const m = normMonth(b.month);
    if (!h || !m) continue;
    const k = `${h}|${m}`;
    const prev = budget.get(k);
    if (prev) {
      const same = Object.keys(budgetCols).every((c) => num(prev[c]) === num(b[c]));
      if (!same) {
        conflictBudget.add(k);
        add({ hotel: h, month: m, field: "budget", kind: "budget conflict", message: "Two different budget rows for this month – budget comparison skipped until confirmed", action: "excluded" });
        continue;
      }
      add({ hotel: h, month: m, field: "budget", kind: "duplicate", message: "Budget row appears more than once with identical values – counted once", action: "info" });
    }
    budget.set(k, b);
  }

  // ---- actuals: normalise, detect duplicates
  const byKey = new Map<string, Raw[]>();
  for (const a of parsed.actuals) {
    const h = normHotel(a.hotel_id);
    const m = normMonth(a.month);
    if (!h || !m) {
      add({ hotel: String(a.hotel_id ?? "?"), month: String(a.month ?? "?"), field: "row", kind: "unreadable row", message: "Hotel or month could not be read – row ignored", action: "excluded" });
      continue;
    }
    if (!hotelById.has(h)) {
      add({ hotel: h, month: m, field: "row", kind: "unknown hotel", message: `Hotel ${h} is not in the Hotels sheet – row ignored`, action: "excluded" });
      continue;
    }
    const k = `${h}|${m}`;
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }

  const fields: [Field, string][] = [
    ["occ", "occupied_rooms"],
    ["el", "electricity_kwh"],
    ["heat", "heating_kwh"],
    ["water", "water_m3"],
  ];
  const budCol: Record<Field, string> = { occ: "occupied_rooms_bu", el: "electricity_kwh_bu", heat: "heating_kwh_bu", water: "water_m3_bu" };

  const rows: Row[] = [];
  for (const [k, list] of byKey) {
    const [hotel, month] = k.split("|");
    let a = list[list.length - 1];
    let conflict = false;
    if (list.length > 1) {
      const same = list.every((x) => fields.every(([, c]) => num(x[c]) === num(list[0][c])));
      conflict = !same;
      const detail = list.map((x) => fields.map(([f, c]) => `${f}=${num(x[c]) ?? "empty"}`).join(", ")).join("  |  ");
      add({
        hotel, month, field: "row", kind: "duplicate",
        message: same
          ? `Row appears ${list.length}× with identical values – counted once`
          : `Row appears ${list.length}× with DIFFERENT values (${detail}) – excluded from all KPIs until the hotel confirms which one is right`,
        action: same ? "info" : "excluded",
      });
    }
    const h = hotelById.get(hotel)!;
    const b = conflictBudget.has(k) ? undefined : budget.get(k);
    const row: Row = {
      hotel, month,
      occ: num(a.occupied_rooms), guests: num(a.guests),
      el: num(a.electricity_kwh), heat: num(a.heating_kwh), water: num(a.water_m3),
      occ_b: b ? num(b.occupied_rooms_bu) : null,
      el_b: b ? num(b.electricity_kwh_bu) : null,
      heat_b: b ? num(b.heating_kwh_bu) : null,
      water_b: b ? num(b.water_m3_bu) : null,
      cost_b: b ? num(b.electricity_cost_bu_eur) : null,
      cost: null, price: null, bad: [],
    };
    if (!b && !conflictBudget.has(k)) add({ hotel, month, field: "budget", kind: "no budget", message: "No budget row for this month – budget comparison skipped", action: "info" });

    if (conflict) {
      row.bad.push("occ", "el", "heat", "water");
      rows.push(row);
      continue;
    }

    for (const [f] of fields) {
      const v = row[f];
      const label = FIELD_LABEL[f];
      const bad = (kind: string, message: string) => {
        row.bad.push(f);
        add({ hotel, month, field: label, kind, message, action: "excluded" });
      };
      if (v === null) { bad("missing", `${label} value is empty or not a number – excluded`); continue; }
      if (v <= 0) { bad(v < 0 ? "negative" : "zero", `${label} reported as ${v} – excluded`); continue; }
      if (f === "occ" && v > h.rooms * daysIn(month)) {
        bad("impossible", `${v} occupied rooms exceeds capacity (${h.rooms} rooms × ${daysIn(month)} days) – excluded`);
        continue;
      }
      const bv = row[`${f}_b` as keyof Row] as number | null;
      if (f !== "occ" && bv && bv > 0) {
        const r = v / bv;
        if (r < 0.05) bad("unit?", `${label} ${v.toLocaleString("en")} is only ${(r * 100).toFixed(1)}% of budget – likely a unit/typing error (e.g. MWh instead of kWh) – excluded`);
        else if (r > 3) bad("implausible", `${label} ${v.toLocaleString("en")} is ${r.toFixed(1)}× budget – implausible, possible meter/typing error – excluded`);
        else if (r < 0.3) add({ hotel, month, field: label, kind: "suspiciously low", message: `${label} is ${(r * 100).toFixed(0)}% of budget – used, but please verify`, action: "flagged" });
      }
    }
    // occupancy 0 although consumption was reported is already caught above; also note guests
    if (row.occ !== null && row.occ > 0 && row.guests !== null && row.guests < row.occ * 0.5) {
      add({ hotel, month, field: "guests", kind: "inconsistent", message: row.guests === 0 ? "Guests reported as 0 although rooms were occupied – not used in any KPI, please correct at source" : "Fewer guests than half the occupied rooms – check entry", action: "flagged" });
    }
    rows.push(row);
  }

  // ---- missing reports (hotel has no row although budget exists up to the latest month)
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const latest = months[months.length - 1] ?? "";
  for (const h of parsed.hotels) {
    for (const m of months) {
      if (!byKey.has(`${h.id}|${m}`)) {
        add({ hotel: h.id, month: m, field: "row", kind: "missing report", message: m === latest ? "Hotel has not reported the latest month yet" : "No report for this month", action: "excluded" });
      }
    }
  }

  // ---- electricity cost with tariff (+ live spot price)
  const missingPrice = new Set<string>();
  for (const r of rows) {
    const h = hotelById.get(r.hotel)!;
    const t = parsed.tariffs[h.country];
    if (!t || r.el === null || r.bad.includes("el")) continue;
    if (t.type === "Fixed") {
      r.price = t.fixed + t.grid;
    } else {
      const p = prices.months[r.month]?.[t.area as "lt" | "lv" | "ee"];
      if (p === undefined) { missingPrice.add(`${t.area}|${r.month}`); continue; }
      r.price = p / 1000 + t.margin + t.grid;
    }
    r.cost = r.el * r.price;
  }
  rows.sort((a, b) => (a.hotel + a.month).localeCompare(b.hotel + b.month));
  return { rows, issues, months, latest, missingPrice: missingPrice.size };
}
