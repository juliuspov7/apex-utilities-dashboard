"use client";
import { useState } from "react";

export default function Login() {
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (res.ok) window.location.href = "/";
    else setErr("Wrong password");
  }
  return (
    <main style={{ maxWidth: 360, margin: "15vh auto", padding: 16, fontFamily: "system-ui" }}>
      <img src="/apex-logo.svg" alt="Apex Alliance" style={{ height: 48, marginBottom: 12 }} />
      <h1 style={{ fontSize: 20 }}>Utilities dashboard</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input type="password" name="password" placeholder="Password" autoFocus required style={{ padding: 8 }} />
        <button style={{ padding: 10, background: "#005a55", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>Open</button>
      </form>
      {err && <p style={{ color: "#b42318" }}>{err}</p>}
    </main>
  );
}
