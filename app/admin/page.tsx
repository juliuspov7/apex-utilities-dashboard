"use client";
import { useRef, useState } from "react";

export default function Admin() {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; warn?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined | null) {
    setMsg(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setMsg({ ok: false, text: "Please choose an Excel (.xlsx) file." });
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setMsg({ ok: false, text: "Choose a file first." });
    setBusy(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (res.ok) {
        setMsg({ ok: true, text: `${j.name} uploaded – ${j.rows} hotel-months read. The dashboard now shows the new data.`, warn: j.warning ?? undefined });
        setFile(null);
      } else setMsg({ ok: false, text: j.error });
    } catch {
      setMsg({ ok: false, text: "Network error, please try again." });
    }
    setBusy(false);
  }

  return (
    <main className="login-page">
      <form className="login-card" style={{ maxWidth: 460 }} onSubmit={submit}>
        <img src="/apex-logo.svg" alt="Apex Alliance" className="login-logo" />
        <h1>Update utilities data</h1>
        <p>Upload the monthly Excel file with the same sheets as before. It is checked first – an unreadable file is rejected and the current data stays live. The previous file is archived automatically.</p>

        <div
          className={`drop ${drag ? "on" : ""} ${file ? "has" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        >
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <>
              
              <b>{file.name}</b>
              <span>{(file.size / 1024).toFixed(0)} KB · click to change</span>
            </>
          ) : (
            <>
              
              <b>Drop the .xlsx file here</b>
              <span>or click to browse</span>
            </>
          )}
        </div>

        <input type="password" name="password" placeholder="Upload password" required autoComplete="off" aria-label="Upload password" />
        {msg && <div className={msg.ok ? "ok-box" : "login-err"} role="alert">{msg.text}</div>}
        {msg?.warn && <div className="warn-box" role="alert">{msg.warn}</div>}
        <button disabled={busy || !file}>{busy ? "Checking and uploading…" : "Upload"}</button>
        <a className="back" href="/">Back to dashboard</a>
      </form>
    </main>
  );
}
