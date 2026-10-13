import { loadDataset } from "@/lib/dataset";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    return Response.json(await loadDataset(force), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
