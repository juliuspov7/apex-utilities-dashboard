import { timingSafeEqual } from "crypto";
import { build, parseWorkbook } from "@/lib/model";
import { CURRENT_FILE, readStored, writeStored } from "@/lib/store";

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
  try {
    // reject files the dashboard could not read; the old file stays live
    const parsed = parseWorkbook(buf);
    build(parsed, { months: {}, status: "unavailable", message: "", fetchedAt: null, now: null });
  } catch (e) {
    return Response.json({ error: `File rejected, previous data kept: ${(e as Error).message}` }, { status: 422 });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const prev = await readStored(CURRENT_FILE).catch(() => null);
  if (prev) await writeStored(`apex/archive/${stamp}-previous.xlsx`, prev.buf, type);
  await writeStored(CURRENT_FILE, buf, type);
  return Response.json({ ok: true, name: file.name, bytes: buf.length });
}
