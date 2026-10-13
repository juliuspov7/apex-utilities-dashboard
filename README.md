# Apex utilities dashboard (Task 2)

Live link: https://apex-utilities-mu.vercel.app (view password supplied separately). Updates: `/admin` (upload password supplied separately).

Anonymised assignment data. Keep this repository private.

## What it shows
- **Portfolio**: one row per hotel, coloured cells = actual vs budget for electricity kWh, electricity €, heating, water. Green < +10 %, amber ≥ +10 %, red ≥ +20 %. Sorted worst first. Headline: number of alerts.
- **Hotel**: tiles, actual-vs-budget trend per utility, electricity per occupied room trend, the hotel's data issues.
- **Data quality**: every excluded or flagged value with the reason. Nothing is silently corrected.
- Filters: country, period (latest month, last 3, YTD, last 12, custom from/to).

## KPI definitions
| KPI | Formula |
|---|---|
| Actual vs budget | Σ actual ÷ Σ budget − 1, only over months where the actual is valid *and* a budget exists (like for like) |
| kWh / occupied room | Σ kWh ÷ Σ occupied rooms (electricity and heating shown separately), months where both are valid |
| kWh / m² | Σ kWh over the **selected period** ÷ gross floor area, so a 12-month period shows ~12× one month. The period is printed next to the figure |
| Water m³ / occupied room | Σ m³ ÷ Σ occupied rooms |
| Electricity cost, fixed hotels | kWh × (fixed price + grid fee) |
| Electricity cost, spot hotels | kWh × (monthly average day-ahead price ÷ 1000 + supplier margin + grid fee) |

Simplification: only monthly consumption exists, so the monthly *simple average* of Elering day-ahead prices is used. With hourly meter data a consumption-weighted price would be more accurate.

## Data-quality rules (`lib/model.ts`)
Excluded from KPIs (and from the matching budget months): empty / non-numeric, zero or negative values, occupied rooms above rooms × days, values < 5 % or > 3× of budget (likely unit or typing error), conflicting duplicate rows, unknown hotels, hotels without tariff or spot price area. Counted once: identical duplicates. Flagged but used: guests inconsistent with occupied rooms, values < 30 % of budget. Info: no budget row, hotel has not reported yet.
Text numbers (`"52 194"`, `"39,5"`) and alternative month/hotel formats (`09.2025`, `Hotel 03`) are understood.

## Updating the data
1. Open `/admin`, choose the new xlsx (same sheets as the original), enter the upload password.
2. The file is validated first; an unreadable file is rejected and the old data stays live. The previous file is archived in Blob (`apex/archive/`). A warning is shown if history that was in the old file is missing.
3. The dashboard checks the file version every minute and reloads itself; the *Refresh now* button forces it immediately.

## Refresh and resilience
- *Refresh now*: re-reads the file and re-fetches prices (`/api/data?force=1`). *Last updated*, the data-file time and the price status are always visible in the header.
- Every 5 h: the open dashboard reloads itself, and a GitHub Actions schedule (`.github/workflows/refresh.yml`, approx. every 5 h, GitHub may delay runs) calls `/api/cron/refresh` (secret `CRON_SECRET`) so prices stay fresh even when nobody has the page open. The run turns red if prices are unavailable or sample data is shown.
- Elering unreachable: last stored prices are used and a yellow banner says so; with no stored prices, spot cost is left empty and the banner says so. Finished months missing an area are re-requested at most every 5 h.
- File missing or unreadable: built-in sample data with a banner.

## Architecture
Next.js (App Router) on Vercel · Vercel Blob (private store) for the data file and price cache · Elering API · password gate in `proxy.ts` (`DASH_PASSWORD`). Real roll-out: Microsoft Entra SSO, one group per hotel / country, read-only for GMs, upload restricted to HQ analysts.
Env vars: `DASH_PASSWORD`, `UPLOAD_PASSWORD`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` (set by linking a private Blob store). Without them (local dev) the gate is off and files go to `.local-store/`.

## Develop
```
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests (node:test)
```
