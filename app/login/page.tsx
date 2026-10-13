"use client";
import { useState } from "react";

export default function Login() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const password = new FormData(e.currentTarget).get("password");
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) }).catch(() => null);
    if (res?.ok) window.location.href = "/";
    else {
      setErr(res ? "Wrong password, please try again." : "Network error, please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img src="/apex-logo.svg" alt="Apex Alliance" className="login-logo" />
        <h1>Utilities dashboard</h1>
        <p>Enter the access password to view hotel utilities, budgets and alerts.</p>
        <input type="password" name="password" placeholder="Password" autoFocus required autoComplete="current-password" aria-label="Password" />
        {err && <div className="login-err" role="alert">{err}</div>}
        <button disabled={busy}>{busy ? "Checking…" : "Open dashboard"}</button>
        <div className="login-foot">Confidential · anonymised assignment data</div>
      </form>
    </main>
  );
}
