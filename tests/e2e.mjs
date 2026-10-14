// End-to-end check of the demo flow against a running deployment:
//   login -> upload updated xlsx -> /api/data shows new month + correction -> bad file rejected, data kept -> original restored.
// Usage: BASE_URL=https://... DASH_PASSWORD=... UPLOAD_PASSWORD=... node tests/e2e.mjs path/to/original.xlsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const { BASE_URL, DASH_PASSWORD, UPLOAD_PASSWORD } = process.env;
const original = process.argv[2];
if (!BASE_URL || !UPLOAD_PASSWORD || !original) {
  console.error("Set BASE_URL, UPLOAD_PASSWORD (and DASH_PASSWORD if gated) and pass the original xlsx path.");
  process.exit(2);
}
let cookie = "";
if (DASH_PASSWORD) {
  const r = await fetch(`${BASE_URL}/api/login`, { method: "POST", body: JSON.stringify({ password: DASH_PASSWORD }) });
  assert.equal(r.status, 200, "login");
  cookie = r.headers.get("set-cookie").split(";")[0];
}
const data = async () => (await fetch(`${BASE_URL}/api/data?force=1`, { headers: { cookie } })).json();
const upload = async (buf, name = "test.xlsx") => {
  const f = new FormData();
  f.set("password", UPLOAD_PASSWORD);
  f.set("file", new Blob([buf]), name);
  const r = await fetch(`${BASE_URL}/api/upload`, { method: "POST", body: f, headers: { cookie } });
  return { status: r.status, body: await r.json() };
};

const origBuf = readFileSync(original);
try {
  assert.equal((await upload(origBuf)).status, 200, "upload original");
  const before = await data();
  const last = before.meta.latestMonth;

  // build an update file: one new month for every hotel + a correction of H04's 72.4 kWh value
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(origBuf);
  const next = (() => { const [y, m] = last.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();
  for (const n of ["Monthly_Actuals", "Monthly_Budget"]) {
    const ws = wb.getWorksheet(n);
    const col = (name) => { let c = 0; ws.getRow(1).eachCell((cell, i) => { if (cell.value === name) c = i; }); return c; };
    const [cMonth, cHotel, cEl] = [col("month"), col("hotel_id"), col("electricity_kwh")];
    const lastRow = ws.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      if (row.getCell(cMonth).value === last) {
        const copy = ws.addRow(row.values.slice(1));
        copy.getCell(cMonth).value = next;
      }
      if (n === "Monthly_Actuals" && row.getCell(cHotel).value === "H04" && row.getCell(cMonth).value === "2025-11") row.getCell(cEl).value = 72400;
    }
  }
  const up = await upload(Buffer.from(await wb.xlsx.writeBuffer()), "update.xlsx");
  assert.equal(up.status, 200, "upload update");
  const after = await data();
  assert.equal(after.meta.latestMonth, next, "new month visible");
  assert.notEqual(after.meta.version, before.meta.version, "version changed");
  const h04 = after.rows.find((r) => r.hotel === "H04" && r.month === "2025-11");
  assert.equal(h04.el, 72400);
  assert.ok(!h04.bad.includes("el"), "correction clears the exclusion");

  // a broken file must be rejected and leave the data untouched
  const bad = new ExcelJS.Workbook();
  bad.addWorksheet("Hotels").addRows([["x"], [1]]);
  const rej = await upload(Buffer.from(await bad.xlsx.writeBuffer()), "broken.xlsx");
  assert.equal(rej.status, 422, "broken file rejected");
  assert.equal((await data()).meta.latestMonth, next, "data kept after rejection");

  // wrong password
  const f = new FormData(); f.set("password", "nope"); f.set("file", new Blob([origBuf]), "x.xlsx");
  assert.equal((await fetch(`${BASE_URL}/api/upload`, { method: "POST", body: f, headers: { cookie } })).status, 401);
  console.log("E2E OK: upload -> new month + correction visible, broken file rejected, wrong password refused");
} finally {
  await upload(origBuf); // restore
}
