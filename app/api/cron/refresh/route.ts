import { timingSafeEqual } from "crypto";
import { loadDataset } from "@/lib/dataset";

export const maxDuration = 60;

/** Called every 5 hours by the GitHub Actions schedule (see .github/workflows/refresh.yml). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const a = Buffer.from(given), b = Buffer.from(secret ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const d = await loadDataset(true);
    return Response.json({
      ok: true,
      refreshedAt: d.meta.generatedAt,
      priceStatus: d.meta.priceStatus,
      source: d.meta.source,
      sourceError: d.meta.sourceError,
      rows: d.rows.length,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
