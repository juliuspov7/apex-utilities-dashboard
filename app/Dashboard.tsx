"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALERT, UTILS, WARN, aggregate, fmt, fmtK, fmtPct, level, perM2, perRoom, pick, type Level } from "@/lib/kpi";
import type { Dataset, Hotel, Issue, Row, Utility } from "@/lib/types";

const REFRESH_MS = 5 * 3600 * 1000;
type Preset = "latest" | "3m" | "ytd" | "12m" | "custom";
type Tab = "portfolio" | "hotel" | "quality";

const ICON: Record<Level, string> = { alert: "▲", warn: "▲", ok: "✓", none: "" };

function ago(iso: string | null, now: number) {
  if (!iso) return "–";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function Heat({ dev }: { dev: number | null }) {
  const l = level(dev);
  return (
    <span className={`heat ${l}`} title={dev === null ? "No valid data in this period (see Data quality)" : `Actual vs budget ${fmtPct(dev)}`}>
      {dev === null ? "no data" : `${ICON[l]} ${fmtPct(dev)}`}
    </span>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastLoad, setLastLoad] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("portfolio");
  const [country, setCountry] = useState("All");
  const [preset, setPreset] = useState<Preset>("latest");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hotelId, setHotelId] = useState("");
  const [trendUtil, setTrendUtil] = useState<Utility>("el");

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/data${force ? "?force=1" : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setData(j);
      setError(null);
      setLastLoad(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message); // keep showing the previous data
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);
  // automatic refresh every 5 hours
  useEffect(() => { const t = setInterval(() => load(true), REFRESH_MS); return () => clearInterval(t); }, [load]);
  // clock for "x min ago"
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  // when the source file changes, pick it up within a minute without any click
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const v = await (await fetch("/api/version", { cache: "no-store" })).json();
        if (data && v.version && v.version !== "unavailable" && v.version !== data.meta.version) load(false);
      } catch { /* offline: keep what we have */ }
    }, 60000);
    return () => clearInterval(t);
  }, [data, load]);

  const months = data?.meta.months ?? [];
  const latest = data?.meta.latestMonth ?? "";

  // resolve the selected period
  const [pFrom, pTo] = useMemo(() => {
    if (!months.length) return ["", ""];
    const last = months[months.length - 1];
    const idx = (n: number) => months[Math.max(0, months.length - n)];
    switch (preset) {
      case "latest": return [last, last];
      case "3m": return [idx(3), last];
      case "ytd": return [months.find((m) => m.startsWith(last.slice(0, 4))) ?? last, last];
      case "12m": return [idx(12), last];
      default: return [from || months[0], to || last];
    }
  }, [months, preset, from, to]);

  const hotels = useMemo(() => (data?.hotels ?? []).filter((h) => country === "All" || h.country === country), [data, country]);
  const hotelIds = useMemo(() => new Set(hotels.map((h) => h.id)), [hotels]);
  const countries = useMemo(() => [...new Set((data?.hotels ?? []).map((h) => h.country))].sort(), [data]);
  const periodRows = useMemo(
    () => (data?.rows ?? []).filter((r) => hotelIds.has(r.hotel) && r.month >= pFrom && r.month <= pTo),
    [data, hotelIds, pFrom, pTo],
  );

  const selHotel: Hotel | undefined = hotels.find((h) => h.id === hotelId) ?? hotels[0];

  const perHotel = useMemo(
    () =>
      hotels.map((h) => {
        const rows = periodRows.filter((r) => r.hotel === h.id);
        const aggs = Object.fromEntries(UTILS.map((u) => [u.key, aggregate(rows, u.key)])) as Record<Utility, ReturnType<typeof aggregate>>;
        const worst = Math.max(...UTILS.map((u) => aggs[u.key].dev ?? -9));
        return {
          h, rows, aggs, worst,
          elRoom: perRoom(rows, "el"), elM2: perM2(rows, [h], "el"), waterRoom: perRoom(rows, "water"),
          missing: rows.length === 0,
        };
      }).sort((a, b) => b.worst - a.worst),
    [hotels, periodRows],
  );

  const total = useMemo(
    () => Object.fromEntries(UTILS.map((u) => [u.key, aggregate(periodRows, u.key)])) as Record<Utility, ReturnType<typeof aggregate>>,
    [periodRows],
  );

  const attention = useMemo(() => {
    const out: { hotel: string; util: string; dev: number; l: Level }[] = [];
    for (const p of perHotel) for (const u of UTILS) {
      const d = p.aggs[u.key].dev;
      if (d !== null && d >= WARN) out.push({ hotel: p.h.id, util: u.label, dev: d, l: level(d) });
    }
    return out.sort((a, b) => b.dev - a.dev);
  }, [perHotel]);

  const issues = useMemo(() => (data?.issues ?? []).filter((i) => hotelIds.has(i.hotel)), [data, hotelIds]);
  const periodIssues = issues.filter((i) => i.month >= pFrom && i.month <= pTo);

  if (!data) {
    return (
      <>
        <Header onRefresh={() => load(true)} loading={loading} data={null} now={now} lastLoad={lastLoad} />
        <div className="wrap">
          <p style={{ marginTop: 32 }}>{error ? `Cannot load data: ${error}` : "Loading…"}</p>
        </div>
      </>
    );
  }
  const m = data.meta;

  return (
    <>
      <Header onRefresh={() => load(true)} loading={loading} data={data} now={now} lastLoad={lastLoad} />
      <div className="wrap">
        {error && <div className="banner alert">Refresh failed ({error}). Showing the data loaded {ago(lastLoad, now)}.</div>}
        {m.sourceError && <div className="banner warn">{m.sourceError}</div>}
        {(m.priceStatus === "cached" || m.priceStatus === "unavailable") && <div className="banner warn">{m.priceMessage}</div>}

        <div className="bar">
          <label>Country
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              <option>All</option>
              {countries.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Period">
            {([["latest", "Latest month"], ["3m", "Last 3 months"], ["ytd", "Year to date"], ["12m", "Last 12 months"]] as [Preset, string][]).map(([k, l]) => (
              <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{l}</button>
            ))}
          </div>
          <label>From
            <select value={pFrom} onChange={(e) => { setFrom(e.target.value); setTo(pTo); setPreset("custom"); }}>
              {months.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>To
            <select value={pTo} onChange={(e) => { setTo(e.target.value); setFrom(pFrom); setPreset("custom"); }}>
              {months.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <span className="small">Period: {pFrom === pTo ? pFrom : `${pFrom} → ${pTo}`}</span>
        </div>

        <div className="tabs">
          <button className={tab === "portfolio" ? "on" : ""} onClick={() => setTab("portfolio")}>Portfolio</button>
          <button className={tab === "hotel" ? "on" : ""} onClick={() => setTab("hotel")}>Hotel</button>
          <button className={tab === "quality" ? "on" : ""} onClick={() => setTab("quality")}>
            Data quality ({periodIssues.filter((i) => i.action !== "info").length})
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {tab === "portfolio" && (
            <Portfolio
              perHotel={perHotel} total={total} attention={attention} rows={periodRows} hotels={hotels}
              allRows={data.rows} hotelIds={hotelIds} pTo={pTo} pFrom={pFrom} months={months}
              trendUtil={trendUtil} setTrendUtil={setTrendUtil}
              open={(id) => { setHotelId(id); setTab("hotel"); }}
            />
          )}
          {tab === "hotel" && selHotel && (
            <HotelView
              hotels={hotels} hotel={selHotel} setHotel={setHotelId} rows={data.rows.filter((r) => r.hotel === selHotel.id)}
              pFrom={pFrom} pTo={pTo} issues={data.issues.filter((i) => i.hotel === selHotel.id)}
              trendUtil={trendUtil} setTrendUtil={setTrendUtil} months={months} nowPrice={m.nowPrice}
            />
          )}
          {tab === "quality" && <Quality issues={issues} pFrom={pFrom} pTo={pTo} latest={latest} />}
        </div>
      </div>
    </>
  );
}

function Header({ data, onRefresh, loading, now, lastLoad }: { data: Dataset | null; onRefresh: () => void; loading: boolean; now: number; lastLoad: string | null }) {
  const m = data?.meta;
  const np = m?.nowPrice;
  return (
    <header className="top">
      <div className="wrap">
        <img src="/apex-logo.svg" alt="Apex Alliance" className="logo" />
        <h1>Utilities dashboard</h1>
        <div className="status">
          <span>Last updated: <b>{lastLoad ? new Date(lastLoad).toLocaleString("en-GB") : "–"}</b> ({ago(lastLoad, now)})</span>
          {m && <span>Data file: {m.source === "upload" && m.sourceUpdatedAt ? new Date(m.sourceUpdatedAt).toLocaleString("en-GB") : "built-in sample"}</span>}
          {m && (
            <span>Prices: {m.priceStatus === "live" ? "live (Elering)" : m.priceStatus === "cached" ? "stored (Elering unreachable)" : m.priceStatus === "unavailable" ? "unavailable" : "n/a"}</span>
          )}
          {np && np.lt !== undefined && (
            <span title={`Day-ahead price at ${np.ts}`}>Now €/MWh: LT {fmt(np.lt ?? null, 0)} · LV {fmt(np.lv ?? null, 0)} · EE {fmt(np.ee ?? null, 0)}</span>
          )}
        </div>
        <div className="sp" />
        <a className="btn" href="/admin" style={{ textDecoration: "none" }}>⬆ Upload data</a>
        <button className="btn primary" onClick={onRefresh} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh now"}</button>
      </div>
    </header>
  );
}

function Tile({ label, agg, unit, money }: { label: string; agg: ReturnType<typeof aggregate>; unit: string; money?: boolean }) {
  const l = level(agg.dev);
  return (
    <div className="card tile">
      <div className="lbl">{label}</div>
      <div className="val">{money && agg.act !== null ? "€" : ""}{fmt(agg.act)}{!money && agg.act !== null ? ` ${unit}` : ""}</div>
      <div className="meta">
        Budget {money && agg.bud !== null ? "€" : ""}{fmt(agg.bud)} · <span className={`pill ${l}`}>{agg.dev === null ? "no data" : `${ICON[l]} ${fmtPct(agg.dev)}`}</span>
      </div>
    </div>
  );
}

function Portfolio(p: {
  perHotel: { h: Hotel; aggs: Record<Utility, ReturnType<typeof aggregate>>; elRoom: number | null; elM2: number | null; waterRoom: number | null; missing: boolean }[];
  total: Record<Utility, ReturnType<typeof aggregate>>;
  attention: { hotel: string; util: string; dev: number; l: Level }[];
  rows: Row[]; hotels: Hotel[]; allRows: Row[]; hotelIds: Set<string>; pFrom: string; pTo: string; months: string[];
  trendUtil: Utility; setTrendUtil: (u: Utility) => void; open: (id: string) => void;
}) {
  const pLabel = p.pFrom === p.pTo ? p.pFrom : `${p.pFrom} → ${p.pTo}`;
  const alerts = p.attention.filter((a) => a.l === "alert");
  const kwhRoom = perRoom(p.rows, "el");
  const kwhM2 = perM2(p.rows, p.hotels, "el");
  const wRoom = perRoom(p.rows, "water");
  const hRoom = perRoom(p.rows, "heat");

  // trend: 12 months ending at the end of the selected period, portfolio level
  const trendMonths = p.months.filter((m) => m <= p.pTo).slice(-Math.max(12, p.months.filter((m) => m >= p.pFrom && m <= p.pTo).length));
  const trend = trendMonths.map((m) => {
    const rs = p.allRows.filter((r) => r.month === m && p.hotelIds.has(r.hotel));
    const a = aggregate(rs, p.trendUtil);
    return { month: m, actual: a.act, budget: a.bud };
  });

  return (
    <div className="grid">
      <div className="card">
        <p className="attn">
          {alerts.length === 0 && p.attention.length === 0
            ? <b>✓ Everything is within 10% of budget in this period.</b>
            : <>
              <b>{alerts.length} alert{alerts.length === 1 ? "" : "s"}</b> (≥ +{ALERT * 100}% vs budget)
              {alerts.length > 0 && <>: {alerts.slice(0, 5).map((a) => `${a.hotel} ${a.util.toLowerCase()} ${fmtPct(a.dev)}`).join(" · ")}{alerts.length > 5 ? " …" : ""}</>}
              {" · "}{p.attention.length - alerts.length} warning{p.attention.length - alerts.length === 1 ? "" : "s"} (≥ +{WARN * 100}%)
            </>}
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Hotel</th><th>Ctry</th>
                {UTILS.map((u) => <th key={u.key} className="n">{u.label} vs budget</th>)}
                <th className="n">kWh / occ. room</th><th className="n" title="Electricity for the whole selected period divided by floor area – a 12-month period shows ~12× a one-month value">kWh / m² (period)</th><th className="n">water m³ / occ. room</th>
              </tr>
            </thead>
            <tbody>
              {p.perHotel.map((x) => (
                <tr key={x.h.id} className="click" onClick={() => p.open(x.h.id)}>
                  <td><b>{x.h.id}</b> <span className="small">{x.h.contract === "Spot" ? "spot" : "fixed"}</span></td>
                  <td>{x.h.country}</td>
                  {UTILS.map((u) => <td key={u.key}><Heat dev={x.aggs[u.key].dev} /></td>)}
                  <td className="n">{fmt(x.elRoom, 1)}</td><td className="n">{fmt(x.elM2, 1)}</td><td className="n">{fmt(x.waterRoom, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Sorted by worst deviation. Green &lt; +{WARN * 100}% · amber ≥ +{WARN * 100}% · red ≥ +{ALERT * 100}% over budget. “no data” = every month of this utility was excluded or has no budget (details in Data quality). Click a row for the hotel view.
        </div>
      </div>

      <div className="grid tiles">
        <Tile label="Electricity" agg={p.total.el} unit="kWh" />
        <Tile label="Electricity cost" agg={p.total.cost} unit="€" money />
        <Tile label="Heating" agg={p.total.heat} unit="kWh" />
        <Tile label="Water" agg={p.total.water} unit="m³" />
        <div className="card tile">
          <div className="lbl">Intensity (portfolio, this period)</div>
          <div className="meta" style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
            Electricity {fmt(kwhRoom, 1)} kWh / occupied room<br />
            Heating {fmt(hRoom, 1)} kWh / occupied room<br />
            Electricity {fmt(kwhM2, 1)} kWh / m² ({pLabel})<br />
            Water {fmt(wRoom, 2)} m³ / occupied room
          </div>
        </div>
      </div>

      <TrendCard title="Portfolio trend" data={trend} util={p.trendUtil} setUtil={p.setTrendUtil} />
    </div>
  );
}

function TrendCard({ title, data, util, setUtil }: { title: string; data: { month: string; actual: number | null; budget: number | null }[]; util: Utility; setUtil: (u: Utility) => void }) {
  const u = UTILS.find((x) => x.key === util)!;
  return (
    <div className="card">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <h2>{title}: {u.label} ({u.unit})</h2>
        <div className="seg">
          {UTILS.map((x) => <button key={x.key} className={util === x.key ? "on" : ""} onClick={() => setUtil(x.key)}>{x.label}</button>)}
        </div>
      </div>
      <div className="legend"><span><i />Actual</span><span><i className="b" />Budget</span></div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "var(--text-3)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
            <YAxis tick={{ fill: "var(--text-3)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtK} width={48} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }}
              formatter={(v, n) => [v === null || v === undefined ? "excluded / no data" : `${fmt(Number(v))} ${u.unit}`, n === "actual" ? "Actual" : "Budget"]}
            />
            <Line type="linear" dataKey="budget" stroke="var(--budget)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="actual" stroke="var(--series)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)" }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="small">Gaps in the actual line are months excluded for data-quality reasons (see Data quality).</div>
    </div>
  );
}

function HotelView(p: {
  hotels: Hotel[]; hotel: Hotel; setHotel: (id: string) => void; rows: Row[]; pFrom: string; pTo: string; issues: Issue[];
  trendUtil: Utility; setTrendUtil: (u: Utility) => void; months: string[]; nowPrice: Dataset["meta"]["nowPrice"];
}) {
  const h = p.hotel;
  const pLabel = p.pFrom === p.pTo ? p.pFrom : `${p.pFrom} → ${p.pTo}`;
  const inPeriod = p.rows.filter((r) => r.month >= p.pFrom && r.month <= p.pTo);
  const aggs = Object.fromEntries(UTILS.map((u) => [u.key, aggregate(inPeriod, u.key)])) as Record<Utility, ReturnType<typeof aggregate>>;
  const trendMonths = p.months.filter((m) => m <= p.pTo).slice(-Math.max(18, inPeriod.length));
  const trend = trendMonths.map((m) => {
    const r = p.rows.find((x) => x.month === m);
    const [a, b] = r ? pick(r, p.trendUtil) : [null, null];
    return { month: m, actual: a, budget: b };
  });
  // intensity trend (electricity kWh per occupied room)
  const intensity = trendMonths.map((m) => {
    const r = p.rows.find((x) => x.month === m);
    const ok = r && r.el !== null && r.occ !== null && !r.bad.includes("el") && !r.bad.includes("occ");
    const bud = r && r.el_b && r.occ_b ? r.el_b / r.occ_b : null;
    return { month: m, actual: ok ? r!.el! / r!.occ! : null, budget: bud };
  });
  const priceNow = h.contract === "Spot" && p.nowPrice ? (p.nowPrice as Record<string, number | string | undefined>) : null;
  const countryArea = ({ LT: "lt", LV: "lv", EE: "ee" } as Record<string, "lt" | "lv" | "ee">)[h.country];
  const live = priceNow && countryArea ? (priceNow[countryArea] as number | undefined) : undefined;

  return (
    <div className="grid">
      <div className="bar" style={{ margin: 0 }}>
        <label>Hotel
          <select value={h.id} onChange={(e) => p.setHotel(e.target.value)}>
            {p.hotels.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.country} · {x.segment}</option>)}
          </select>
        </label>
        <span className="small">
          {h.rooms} rooms · {fmt(h.gfa)} m² · heating: {h.heating} · electricity: {h.contract === "Spot" ? "spot (day-ahead + margin + grid)" : "fixed tariff"}
          {live !== undefined && <> · current day-ahead {fmt(live, 0)} €/MWh</>}
        </span>
      </div>
      <div className="grid tiles" style={{ margin: 0 }}>
        <Tile label="Electricity" agg={aggs.el} unit="kWh" />
        <Tile label="Electricity cost" agg={aggs.cost} unit="€" money />
        <Tile label="Heating" agg={aggs.heat} unit="kWh" />
        <Tile label="Water" agg={aggs.water} unit="m³" />
        <div className="card tile">
          <div className="lbl">Intensity (this period)</div>
          <div className="meta" style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
            {fmt(perRoom(inPeriod, "el"), 1)} kWh electricity / occ. room<br />
            {fmt(perRoom(inPeriod, "heat"), 1)} kWh heating / occ. room<br />
            {fmt(perM2(inPeriod, [h], "el"), 1)} kWh electricity / m² ({pLabel})<br />
            {fmt(perRoom(inPeriod, "water"), 2)} m³ water / occ. room
          </div>
        </div>
      </div>
      <div className="grid twocol">
        <TrendCard title={h.id} data={trend} util={p.trendUtil} setUtil={p.setTrendUtil} />
        <div className="card">
          <h2>{h.id}: electricity per occupied room (kWh)</h2>
          <div className="legend"><span><i />Actual</span><span><i className="b" />Budget (budget kWh ÷ budget rooms)</span></div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={intensity} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "var(--text-3)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                <YAxis tick={{ fill: "var(--text-3)", fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} tickFormatter={(v) => fmt(v, 0)} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} formatter={(v, n) => [v === null || v === undefined ? "excluded / no data" : `${fmt(Number(v), 1)} kWh`, n === "actual" ? "Actual" : "Budget"]} />
                <Line type="linear" dataKey="budget" stroke="var(--budget)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="actual" stroke="var(--series)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Data issues for {h.id}</h2>
        <IssueTable issues={p.issues} />
      </div>
    </div>
  );
}

const KIND_LABEL = { excluded: "Excluded from KPIs", flagged: "Flagged (used)", info: "Info" } as const;

function IssueTable({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="small">No issues.</p>;
  const sorted = [...issues].sort((a, b) => b.month.localeCompare(a.month) || a.hotel.localeCompare(b.hotel));
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Month</th><th>Hotel</th><th>Field</th><th>Handling</th><th>What we found</th></tr></thead>
        <tbody>
          {sorted.map((i, k) => (
            <tr key={k}>
              <td>{i.month}</td><td>{i.hotel}</td><td>{i.field}</td>
              <td><span className={`pill ${i.action === "excluded" ? "alert" : i.action === "flagged" ? "warn" : "none"}`}>{KIND_LABEL[i.action]}</span></td>
              <td>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Quality({ issues, pFrom, pTo, latest }: { issues: Issue[]; pFrom: string; pTo: string; latest: string }) {
  const [scope, setScope] = useState<"period" | "all">("period");
  const [act, setAct] = useState<"all" | Issue["action"]>("all");
  const list = issues.filter((i) => (scope === "all" || (i.month >= pFrom && i.month <= pTo)) && (act === "all" || i.action === act));
  const c = (a: Issue["action"]) => issues.filter((i) => (scope === "all" || (i.month >= pFrom && i.month <= pTo)) && i.action === a).length;
  return (
    <div className="card">
      <h2>Data quality</h2>
      <div className="sub">
        Manual reports are never silently corrected. Excluded values are left out of the KPIs (and of the matching budget months); flagged values are used but need a check. Latest month in file: {latest}.
      </div>
      <div className="bar" style={{ marginTop: 0 }}>
        <div className="seg">
          <button className={scope === "period" ? "on" : ""} onClick={() => setScope("period")}>Selected period</button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All months</button>
        </div>
        <div className="seg">
          <button className={act === "all" ? "on" : ""} onClick={() => setAct("all")}>All</button>
          <button className={act === "excluded" ? "on" : ""} onClick={() => setAct("excluded")}>Excluded ({c("excluded")})</button>
          <button className={act === "flagged" ? "on" : ""} onClick={() => setAct("flagged")}>Flagged ({c("flagged")})</button>
          <button className={act === "info" ? "on" : ""} onClick={() => setAct("info")}>Info ({c("info")})</button>
        </div>
      </div>
      <IssueTable issues={list} />
    </div>
  );
}
