# Apex utilities dashboard

Live utilities dashboard (actual vs budget, intensity KPIs, spot-price electricity cost, data-quality checks) for the Apex stage-2 assignment, Task 2.

- **Stack:** Next.js (App Router) on Vercel, Vercel Blob (private) for the data file, Elering API for day-ahead prices.
- **Data flow:** `/admin` upload (xlsx) -> Blob `apex/current.xlsx` -> `/api/data` parses, validates, prices, returns JSON -> dashboard. Falls back to `data/seed.xlsx` if no usable file exists.
- **Env vars:** `DASH_PASSWORD` (view gate), `UPLOAD_PASSWORD` (admin upload), `BLOB_READ_WRITE_TOKEN` (set by linking a private Blob store). Without them (local dev) the gate is off and files are stored in `.local-store/`.
- **Run locally:** `npm install && npm run dev`.

Data in `data/` is anonymised assignment data: keep this repository private.
