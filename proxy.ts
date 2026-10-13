import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, gateToken } from "@/lib/gate";

// Simple view-password gate. If DASH_PASSWORD is not set (local dev) everything is open.
export async function proxy(req: NextRequest) {
  const pw = process.env.DASH_PASSWORD;
  if (!pw) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/apex-logo.svg") return NextResponse.next();
  if (req.cookies.get(GATE_COOKIE)?.value === (await gateToken(pw))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
