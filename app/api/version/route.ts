import { currentVersion } from "@/lib/dataset";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ version: await currentVersion() }, { headers: { "Cache-Control": "no-store" } });
}
