import { timingSafeEqual } from "crypto";
import { build, parseWorkbook } from "@/lib/model";
import { ConflictError, CURRENT_FILE, readStored, writeStored } from "@/lib/store";

export const dynamic = "force-dynamic";

function ok(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  const expected = process.env.UPLOAD_PASSWORD;
  if (!expected) return Response.json({ error: "UPLOAD_PASSWORD is not configured on the server" }, { status: 500 });
  const form = await req.formData();
  if (!ok(String(form.get("password") ?? ""), expected)) return Response.json({ error: "Wrong password" }, { status: 401 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  let newKeys = new Set<string>();
  let badShare = 0;
  try {
    // reject files the dashboard could not read; the old file stays live
    const parsed = await parseWorkbook(buf);
    const built = build(parsed, { months: {}, status: "unavailable", message: "", fetchedAt: null, now: null });
    if (built.rows.length === 0) throw new Error("no usable rows in Monthly_Actuals");
    const rejected = built.rows.filter((r) => r.bad.length > 0).length;
    badShare = rejected / built.rows.length;
    newKeys = new Set(built.rows.map((r) => `${r.hotel}|${r.month}`));
  } catch (e) {
    return Response.json({ error: `File rejected, previous data kept: ${(e as Error).message}` }, { status: 422 });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const prev = await readStored(CURRENT_FILE).catch(() => null);
  if (prev) await writeStored(`apex/archive/${stamp}-previous.xlsx`, prev.buf, type);
  // warn (do not block) when history that was in the previous file is missing from the new one
  let warning: string | null = null;
  if (prev) {
    try {
      const old = build(await parseWorkbook(prev.buf), { months: {}, status: "unavailable", message: "", fetchedAt: null, now: null });
      const lost = old.rows.filter((r) => !newKeys.has(`${r.hotel}|${r.month}`)).length;
      if (lost > 0) warning = `${lost} hotel-month row(s) that were in the previous file are missing from this one.`;
    } catch { /* previous file unreadable: nothing to compare */ }
  }
  if (badShare >= 0.1) {
    const txt = `${(badShare * 100).toFixed(0)}% of the hotel-months have values that are excluded from KPIs – please check the file (see Data quality).`;
    warning = warning ? `${warning} ${txt}` : txt;
  }
  try {
    // only replace the file we compared against: a parallel upload by someone else is refused, not silently overwritten
    await writeStored(CURRENT_FILE, buf, type, prev ? prev.etag : null);
  } catch (e) {
    if (e instanceof ConflictError) return Response.json({ error: "Someone uploaded a file at the same moment. Nothing was changed by this upload; reload the dashboard and upload again if needed." }, { status: 409 });
    throw e;
  }
  return Response.json({ ok: true, name: file.name, bytes: buf.length, rows: newKeys.size, badShare, warning });
}
