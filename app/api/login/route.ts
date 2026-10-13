import { timingSafeEqual } from "crypto";
import { GATE_COOKIE, gateToken } from "@/lib/gate";

export async function POST(req: Request) {
  const pw = process.env.DASH_PASSWORD;
  if (!pw) return Response.json({ ok: true });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const a = Buffer.from(String(password ?? "")), b = Buffer.from(pw);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Wrong password" }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${GATE_COOKIE}=${await gateToken(pw)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
  return res;
}
