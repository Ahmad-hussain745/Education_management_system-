"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createUserAccount } from "./actions";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";
import OnlineRequiredGate from "@/components/OnlineRequiredGate";

export default function NewUserForm({ roles, unlinkedTeachers }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [roleId, setRoleId] = useState("");
  const formRef = useRef(null);
  const router = useRouter();
  const online = useOnline();

  const selectedRoleName = (roles || []).find((r) => r.id === roleId)?.name;
  const isTeacherRole = selectedRoleName === "Teacher";

  const handleSubmit = async (formData) => {
    // User administration creates a real Supabase Auth account — nothing
    // to queue for later, so it's ONLINE REQUIRED. See
    // lib/offline/online-required.js.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    setPending(true);
    setError("");
    const res = await createUserAccount(formData);
    setPending(false);
    if (res?.error) { setError(res.error); return; }
    formRef.current?.reset();
    setRoleId("");
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <OnlineRequiredGate>
        <button onClick={() => setOpen(true)} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">
          + New User
        </button>
      </OnlineRequiredGate>
    );
  }

  return (
    <form ref={formRef} action={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="text-sm font-semibold text-ink">New User</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input name="name" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input name="email" type="email" required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <input name="password" type="password" required minLength={8} placeholder="At least 8 characters" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
          <select name="role_id" required value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Select…</option>
            {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {isTeacherRole && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Link to Teacher (optional)</label>
            <select name="teacher_id" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— No link —</option>
              {(unlinkedTeachers || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Linking turns on that teacher's "own" scope — own attendance, own classes, own salary. Only
              teachers without an existing login are listed.
            </p>
          </div>
        )}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <div className="text-sm text-slate-500 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
            New users start active — deactivate afterward from the list if needed.
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-600">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
          {pending ? "Creating…" : "Create User"}
        </button>
      </div>
    </form>
  );
}
