"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkParent, unlinkParent } from "./parentActions";

export default function ParentAccess({ studentId, links, unlinkedParents, isAdmin }) {
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleLink = (e) => {
    e.preventDefault();
    if (!selected) return;
    setError("");
    startTransition(async () => {
      const res = await linkParent(studentId, selected);
      if (res?.error) { setError(res.error); return; }
      setSelected("");
      router.refresh();
    });
  };

  const handleUnlink = (linkId) => {
    if (!confirm("Remove this parent's portal access to this student?")) return;
    setError("");
    startTransition(async () => {
      const res = await unlinkParent(linkId, studentId);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-semibold text-ink mb-2">Parent Portal Access</div>
      <p className="text-xs text-slate-500 mb-3">
        A linked Parent account can see this student's Profile, Attendance, Fees, Receipts, Syllabus and
        Notifications through the parent portal — nothing else, and no other student.
      </p>

      <ul className="space-y-1 mb-3">
        {(links || []).map((l) => (
          <li key={l.id} className="flex items-center justify-between text-sm">
            <span>{l.parent?.name} <span className="text-slate-400">({l.parent?.email})</span></span>
            {isAdmin && (
              <button onClick={() => handleUnlink(l.id)} disabled={pending} className="text-xs text-brick">Remove</button>
            )}
          </li>
        ))}
        {(!links || links.length === 0) && <li className="text-sm text-slate-400">No parent account linked yet.</li>}
      </ul>

      {isAdmin && (
        <form onSubmit={handleLink} className="flex items-center gap-2">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1">
            <option value="">Link a Parent account…</option>
            {(unlinkedParents || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
          </select>
          <button type="submit" disabled={pending || !selected} className="text-sm px-3 py-1.5 rounded-lg bg-royal text-white disabled:opacity-60">Link</button>
        </form>
      )}
      {isAdmin && (!unlinkedParents || unlinkedParents.length === 0) && (
        <p className="text-xs text-slate-400 mt-2">
          No unlinked Parent accounts exist yet — create one from Settings → Users with the Parent role.
        </p>
      )}
      {error && <p className="text-sm text-brick mt-2">{error}</p>}
    </div>
  );
}
