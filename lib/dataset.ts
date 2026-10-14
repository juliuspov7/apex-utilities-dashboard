import { promises as fs } from "fs";
import path from "path";
import { build, normMonth, parseWorkbook, type Parsed } from "./model";
import { getPrices } from "./prices";
import { CURRENT_FILE, readStored } from "./store";
import type { Dataset } from "./types";

async function readSeed() {
  return fs.readFile(path.join(process.cwd(), "data", "seed.xlsx"));
}

export async function currentVersion(): Promise<string> {
  try {
    const s = await readStored(CURRENT_FILE);
    return s ? s.updatedAt.toISOString() : "seed";
  } catch {
    return "unavailable";
  }
}

export async function loadDataset(force = false): Promise<Dataset> {
  let parsed: Parsed;
  let source: Dataset["meta"]["source"] = "upload";
  let sourceUpdatedAt: string | null = null;
  let sourceError: string | null = null;

  let stored = null;
  try {
    stored = await readStored(CURRENT_FILE);
  } catch (e) {
    sourceError = `Data store unavailable (${(e as Error).message}) – showing built-in sample data`;
  }
  try {
    if (!stored) throw new Error(sourceError ?? "No data file uploaded yet – showing built-in sample data");
    parsed = await parseWorkbook(stored.buf);
    sourceUpdatedAt = stored.updatedAt.toISOString();
    sourceError = null;
  } catch (e) {
    sourceError = stored ? `Uploaded file could not be read: ${(e as Error).message} – showing built-in sample data` : (e as Error).message;
    source = "built-in sample";
    parsed = await parseWorkbook(await readSeed());
  }

  const months = [...new Set(parsed.actuals.map((a) => normMonth(a.month)).filter((m): m is string => !!m))].sort();
  const needsSpot = parsed.hotels.some((h) => h.contract === "Spot");
  const prices = await getPrices(months, needsSpot, force);
  const built = build(parsed, prices);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      sourceUpdatedAt,
      sourceError,
      priceStatus: built.missingPrice > 0 && prices.status === "live" ? "cached" : prices.status,
      priceMessage: built.missingPrice > 0 ? `${prices.message}. ${built.missingPrice} hotel-area/month price(s) missing – cost not calculated for them` : prices.message,
      priceFetchedAt: prices.fetchedAt,
      nowPrice: prices.now,
      months: built.months,
      latestMonth: built.latest,
      version: sourceUpdatedAt ?? "seed",
    },
    hotels: parsed.hotels,
    rows: built.rows,
    issues: built.issues,
  };
}
