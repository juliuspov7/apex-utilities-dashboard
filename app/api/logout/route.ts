import { GATE_COOKIE } from "@/lib/gate";

/** Ends the session: the gate cookie is cleared, so the login page is shown again. */
export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${GATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}
