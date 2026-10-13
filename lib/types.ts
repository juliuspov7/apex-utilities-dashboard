export type Field = "occ" | "el" | "heat" | "water";
export type Utility = "el" | "cost" | "heat" | "water";

export interface Hotel {
  id: string;
  name: string;
  country: string;
  segment: string;
  rooms: number;
  gfa: number;
  heating: string;
  contract: "Fixed" | "Spot";
}

export interface Issue {
  hotel: string;
  month: string;
  field: string;
  kind: string;
  message: string;
  /** excluded = not used in KPIs; flagged = used but shown; info = context only */
  action: "excluded" | "flagged" | "info";
}

export interface Row {
  hotel: string;
  month: string;
  occ: number | null;
  guests: number | null;
  el: number | null;
  heat: number | null;
  water: number | null;
  occ_b: number | null;
  el_b: number | null;
  heat_b: number | null;
  water_b: number | null;
  cost_b: number | null;
  /** actual electricity cost in EUR (null if electricity invalid or spot price unavailable) */
  cost: number | null;
  /** €/kWh all-in used for cost, null if not computable */
  price: number | null;
  /** fields excluded from KPIs because of a data-quality issue */
  bad: Field[];
}

export type PriceStatus = "live" | "cached" | "unavailable" | "not-needed";

export interface Meta {
  generatedAt: string;
  source: "upload" | "built-in sample";
  sourceUpdatedAt: string | null;
  sourceError: string | null;
  priceStatus: PriceStatus;
  priceMessage: string;
  priceFetchedAt: string | null;
  /** current day-ahead price (€/MWh) per area */
  nowPrice: { ts: string; lt?: number; lv?: number; ee?: number } | null;
  months: string[];
  latestMonth: string;
  version: string;
}

export interface Dataset {
  meta: Meta;
  hotels: Hotel[];
  rows: Row[];
  issues: Issue[];
}
