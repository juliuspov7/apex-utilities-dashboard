import { PRICE_CACHE, readStored, writeStored } from "./store";
import type { PriceStatus } from "./types";

type Area = "lt" | "lv" | "ee";
const AREAS: Area[] = ["lt", "lv", "ee"];
const REFRESH_MS = 5 * 3600 * 1000;

interface MonthPrice {
  lt?: number;
  lv?: number;
  ee?: number; // monthly simple average, EUR/MWh
  fetchedAt: string;
  complete: boolean;
}
interface Cache {
  months: Record<string, MonthPrice>;
  now?: { ts: string; lt?: number; lv?: number; ee?: number; fetchedAt: string };
}

export interface PriceResult {
  /** month -> area -> EUR/MWh */
  months: Record<string, Partial<Record<Area, number>>>;
  status: PriceStatus;
  message: string;
  fetchedAt: string | null;
  now: { ts: string; lt?: number; lv?: number; ee?: number } | null;
}

async function elering(startIso: string, endIso: string) {
  const url = `https://dashboard.elering.ee/api/nps/price?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`Elering HTTP ${res.status}`);
  const j = await res.json();
  if (!j.success) throw new Error("Elering returned success=false");
  return j.data as Record<Area, { timestamp: number; price: number }[]>;
}

function avg(points: { price: number }[] | undefined) {
  if (!points || points.length === 0) return undefined;
  return points.reduce((s, p) => s + p.price, 0) / points.length;
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1) - 1000);
  return { start, end };
}

async function loadCache(): Promise<Cache> {
  try {
    const s = await readStored(PRICE_CACHE);
    if (s) return JSON.parse(s.buf.toString("utf8")) as Cache;
  } catch {
    /* corrupt cache is treated as empty */
  }
  return { months: {} };
}

export async function getPrices(months: string[], needed: boolean, force: boolean): Promise<PriceResult> {
  if (!needed) {
    return { months: {}, status: "not-needed", message: "No spot-price hotels in view", fetchedAt: null, now: null };
  }
  const cache = await loadCache();
  const nowMs = Date.now();
  const old = (mp: MonthPrice) => nowMs - Date.parse(mp.fetchedAt) > REFRESH_MS;
  // refetch when: never fetched; month still running; or a finished month is missing an area
  // (retried at most every 5 h, or immediately on a manual refresh)
  const stale = (mp?: MonthPrice) =>
    !mp || (!mp.complete && (force || old(mp))) || (AREAS.some((a) => mp[a] === undefined) && (force || old(mp)));

  const todo = months.filter((m) => stale(cache.months[m]));
  const errors: string[] = [];
  let changed = false;

  // fetch in small parallel batches, one request per month
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (m) => {
        try {
          const { start, end } = monthBounds(m);
          const d = await elering(start.toISOString(), end.toISOString());
          const entry: MonthPrice = {
            fetchedAt: new Date().toISOString(),
            complete: end.getTime() < nowMs,
          };
          for (const a of AREAS) entry[a] = avg(d[a]);
          if (AREAS.every((a) => entry[a] === undefined)) throw new Error(`no prices returned for ${m}`);
          cache.months[m] = entry;
          changed = true;
        } catch (e) {
          errors.push(`${m}: ${(e as Error).message}`);
        }
      }),
    );
  }

  // "price right now" for the header badge
  let nowOk = true;
  if (force || !cache.now || nowMs - Date.parse(cache.now.fetchedAt) > REFRESH_MS) {
    try {
      const d = await elering(new Date(nowMs - 3 * 3600e3).toISOString(), new Date(nowMs + 24 * 3600e3).toISOString());
      const cur: NonNullable<Cache["now"]> = { ts: "", fetchedAt: new Date().toISOString() };
      const nowSec = nowMs / 1000;
      for (const a of AREAS) {
        const p = (d[a] ?? []).filter((x) => x.timestamp <= nowSec).pop();
        if (p) {
          cur[a] = p.price;
          cur.ts = new Date(p.timestamp * 1000).toISOString();
        }
      }
      cache.now = cur;
      changed = true;
    } catch (e) {
      nowOk = false;
      errors.push(`current price: ${(e as Error).message}`);
    }
  }

  if (changed) {
    try {
      await writeStored(PRICE_CACHE, JSON.stringify(cache), "application/json");
    } catch {
      /* cache write failure must never break the dashboard */
    }
  }

  const out: PriceResult["months"] = {};
  const missing: string[] = [];
  for (const m of months) {
    const mp = cache.months[m];
    if (mp) out[m] = { lt: mp.lt, lv: mp.lv, ee: mp.ee };
    else missing.push(m);
  }
  const usedCache = errors.length > 0 || todo.length === 0;
  let status: PriceStatus = "live";
  let message = "Live day-ahead prices from Elering";
  if (errors.length) {
    status = missing.length < months.length ? "cached" : "unavailable";
    message =
      status === "cached"
        ? `Elering unreachable for some periods – using last stored prices (${errors.length} request(s) failed)`
        : "Elering unreachable and no stored prices – spot-hotel electricity cost cannot be calculated";
  } else if (usedCache && todo.length === 0) {
    message = "Day-ahead prices from Elering (stored, refreshed every 5 h)";
  }
  return {
    months: out,
    status,
    message,
    fetchedAt: cache.now?.fetchedAt ?? null,
    now: nowOk && cache.now ? { ts: cache.now.ts, lt: cache.now.lt, lv: cache.now.lv, ee: cache.now.ee } : cache.now ?? null,
  };
}
