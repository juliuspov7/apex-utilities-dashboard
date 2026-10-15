# Apex utilities dashboard (Task 2)

> Recruitment assignment prototype, independently developed for Apex Alliance Hotel Management. Not an official company system. Demo data only.

A web dashboard that compares the monthly utility data of the Apex hotels with their budget and shows which hotel and which utility needs attention. It also calculates electricity cost, using the live day-ahead price for hotels on a spot contract.

- **Live:** https://apex-utilities-mu.vercel.app (view password is sent separately)
- **Update the data:** `/admin` (upload password is sent separately), or the “Upload data” link in the dashboard header
- The data is anonymised assignment data. Keep this repository private.

## What you see

| Screen | What it shows |
|---|---|
| **Portfolio** | One row per hotel, sorted worst first. Coloured cells show actual vs budget for electricity kWh, electricity €, heating and water (green below +10 %, amber from +10 %, red from +20 %). Next to them: kWh per occupied room, kWh per m² (electricity and heating) and water m³ per occupied room. Totals and a trend chart below. |
| **Hotel** | The same numbers for one hotel, a trend per utility, electricity per occupied room over time, and the data problems found for that hotel. |
| **Data quality** | Every value that was excluded or flagged, with the reason. Nothing is corrected silently. |

Filters: country, and period (latest month, last 3 months, year to date, last 12 months, or a custom range). The header always shows when the data was last updated, when the data file was uploaded, and whether the electricity prices are live.

## How it works

```
Excel file ──► /admin upload ──► private Blob storage
                (checked first)         │
                                        ▼
   Elering day-ahead prices ──► /api/data: read file → apply data checks → add tariffs and prices → calculate KPIs
                                        │
                                        ▼
                                  dashboard in the browser
```

1. An analyst uploads the monthly Excel file (same four sheets as the original: Hotels, Tariffs, Monthly_Actuals, Monthly_Budget). A file that cannot be read is rejected and the old data stays. The previous file is archived.
2. `/api/data` reads the current file, finds data problems, adds the electricity price and calculates everything.
3. The browser shows the result. It checks every minute whether a new file was uploaded and reloads by itself.

## Where things are

| File | What it does |
|---|---|
| `app/page.tsx`, `app/layout.tsx` | The page shell. |
| `app/Dashboard.tsx` | The whole dashboard screen: filters, portfolio table, hotel view, data quality list, charts, refresh button and the 5-hour reload. |
| `app/admin/page.tsx` | The upload page. |
| `app/login/page.tsx`, `app/api/login/route.ts`, `proxy.ts`, `lib/gate.ts` | The password gate. `proxy.ts` sends visitors without the cookie to the login page. |
| `app/api/data/route.ts` | Returns the calculated data to the dashboard (`?force=1` also refreshes the prices). |
| `app/api/version/route.ts` | Returns the time of the last upload, so the browser can notice a new file. |
| `app/api/upload/route.ts` | Receives the Excel file, checks it, archives the old one and stores the new one. The new file replaces the current one only if nobody changed it in between; otherwise the upload is refused (409). |
| `app/api/cron/refresh/route.ts` | Called by the scheduled job to refresh prices. Protected by `CRON_SECRET`. Returns an error status if prices are missing or sample data is shown. |
| `lib/model.ts` | **The data rules.** Reads the workbook (ExcelJS), finds duplicates, wrong units, missing and impossible values, and calculates electricity cost. |
| `lib/kpi.ts` | The KPI formulas (actual vs budget, per room, per m²) and the alert levels. |
| `lib/prices.ts` | Fetches the Elering day-ahead prices, averages them per month and keeps them in storage. Retries missing months and falls back to stored prices. Saves with a version check and merges with a parallel refresh. |
| `lib/dataset.ts` | Puts it together: loads the file (or the built-in sample), the prices and the model. |
| `lib/store.ts` | Storage: private Vercel Blob, or a local folder when running locally. Supports conditional writes (version check) so parallel changes cannot overwrite each other. |
| `lib/types.ts` | Shared types. |
| `data/seed.xlsx` | The original assignment data (Appendix B). Not in Git (listed in `.gitignore`); place the file here, the deployed app includes it. Shown only if no file has been uploaded or the uploaded file cannot be read. |
| `tests/model.test.ts` | Unit tests of the data rules and tariffs. |
| `tests/e2e.mjs` | End-to-end check against a running site: upload, new month visible, correction applied, broken file and wrong password refused. |
| `tests/Apex_TEST_01…03.xlsx` | Not in Git (listed in `.gitignore`). Three workbooks, made from the assignment data, for trying the upload by hand: a new month with a correction, a file with data-quality problems, and a file with an invalid structure. |
| `.github/workflows/refresh.yml` | Calls the refresh endpoint about every 5 hours. |
| `.github/workflows/test.yml` | Runs the type check and unit tests on every push. |

## KPI definitions

| KPI | Calculation |
|---|---|
| Actual vs budget | Total actual ÷ total budget − 1, only for months where both a valid actual and a budget exist |
| kWh per occupied room | Total kWh ÷ total occupied rooms (electricity and heating shown separately) |
| kWh per m² | Total kWh of the **selected period** ÷ floor area. A 12-month period therefore shows about twelve times a one-month value, and the period is printed next to the number |
| Water per occupied room | Total m³ ÷ total occupied rooms |
| Electricity cost, fixed tariff | kWh × (fixed price + grid fee) |
| Electricity cost, spot tariff | kWh × (monthly average day-ahead price ÷ 1000 + supplier margin + grid fee) |

Only monthly consumption exists, so the monthly simple average of the day-ahead price is used. Using hourly meter data would allow a consumption-weighted price.

## Data checks (`lib/model.ts`)

- **Excluded from the KPIs, and listed with a reason:** empty or non-numeric values, zero or negative values, occupied rooms above what the hotel can physically have, values below 5 % or above 3× the budget (likely a unit or typing error), conflicting duplicate rows, rows for unknown hotels, hotels without a tariff.
- **Counted once:** identical duplicate rows.
- **Used but flagged:** guests that do not fit the occupied rooms; values below 30 % of budget; months without a budget row.
- Text numbers (`"52 194"`, `"39,5"`) and other month or hotel formats (`09.2025`, `Hotel 03`) are understood.

## If something is missing

| Situation | What the dashboard does |
|---|---|
| Elering cannot be reached | Uses the last stored prices and shows a yellow banner. With no stored prices, spot cost is left empty and the banner says so. |
| The uploaded file cannot be read | The upload is rejected and the previous data stays. |
| No file has been uploaded | Shows the built-in sample data with a banner. |
| The scheduled refresh finds missing prices | The GitHub job turns red (the dashboard itself keeps working). |

## Settings (environment variables)

| Name | Purpose |
|---|---|
| `DASH_PASSWORD` | Password to open the dashboard. If it is not set, there is no password (local use). |
| `UPLOAD_PASSWORD` | Password for the upload page. |
| `CRON_SECRET` | Secret for the scheduled refresh. Also stored as a GitHub secret together with `DASHBOARD_URL`. |
| `BLOB_READ_WRITE_TOKEN` | Set by connecting a **private** Vercel Blob store to the project. Without it, files are kept in `.local-store/`. |

## Run it yourself

```
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
npm run e2e -- path/to/original.xlsx   # against a running site: BASE_URL, DASH_PASSWORD, UPLOAD_PASSWORD
```

## Real roll-out

The demo uses one shared view password. In a real roll-out I would use Microsoft Entra ID sign-in with groups per country or hotel (read only), and limit the upload to HQ analysts. The archive of uploaded files serves as the audit trail.

## Limitations

- Electricity price uses a monthly average, see above. Prices exclude any VAT or taxes that are not in the Tariffs sheet.
- Parallel uploads: the new file replaces the current one only if nobody changed it in between (version check); otherwise the upload is refused with a message. The price cache uses the same check and merges with a parallel refresh.
- Alert thresholds (10 % and 20 %) are fixed in the code.
- The scheduled refresh is approximate: GitHub may delay scheduled runs.
- Corrections are shown in the dashboard but not written back to the source Excel.
