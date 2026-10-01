"use client";

import { useState } from "react";

export default function BackupExportForm() {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const strengthOk = passphrase.length >= 12;
  const matches = passphrase === confirm && confirm.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setDone(false);

    if (!strengthOk) { setError("Passphrase must be at least 12 characters."); return; }
    if (!matches) { setError("Passphrases don't match."); return; }

    setPending(true);
    try {
      const res = await fetch("/api/export/institute-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || "institute-backup.msabak";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDone(true);
      setPassphrase("");
      setConfirm("");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Passphrase (min. 12 characters)</label>
        <input
          type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Confirm passphrase</label>
        <input
          type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" autoComplete="new-password"
        />
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
        There is no way to recover this file without the passphrase — not from us, not from
        Supabase, not from anywhere. Write it down somewhere separate from the downloaded file itself.
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}
      {done && <p className="text-sm text-sage">Downloaded. Keep the file and the passphrase in separate places.</p>}

      <button
        type="submit"
        disabled={pending}
        className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {pending ? "Preparing export…" : "Download Encrypted Backup"}
      </button>
    </form>
  );
}
