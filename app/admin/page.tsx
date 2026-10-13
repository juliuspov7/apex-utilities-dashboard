"use client";
import { useState } from "react";

export default function Admin() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await res.json();
      setMsg(res.ok ? { ok: true, text: `Uploaded ${j.name} (${j.rows} hotel-months). The dashboard shows the new data immediately.${j.warning ? " ⚠ " + j.warning : ""}` } : { ok: false, text: j.error });
    } catch {
      setMsg({ ok: false, text: "Network error" });
    }
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 480, margin: "10vh auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22 }}>Update utilities data</h1>
      <p style={{ color: "#555" }}>Upload the monthly Excel file (same sheets as before). The previous file is archived automatically.</p>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input type="file" name="file" accept=".xlsx" required />
        <input type="password" name="password" placeholder="Upload password" required style={{ padding: 8 }} />
        <button disabled={busy} style={{ padding: 10, background: "#005a55", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
      {msg && <p style={{ color: msg.ok ? "#0a7a3b" : "#b42318", marginTop: 16 }}>{msg.text}</p>}
      <p style={{ marginTop: 24 }}><a href="/">← Back to dashboard</a></p>
    </main>
  );
}
