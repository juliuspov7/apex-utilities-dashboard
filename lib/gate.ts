/** Cookie token derived from the view password (SHA-256 via Web Crypto, works in proxy and route handlers). */
export async function gateToken(password: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`apex-gate:${password}`));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const GATE_COOKIE = "apex_gate";
