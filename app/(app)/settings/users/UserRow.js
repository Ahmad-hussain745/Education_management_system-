"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleUserStatus, updateUserRole } from "./actions";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";

export default function UserRow({ user, roles, isSelf }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const online = useOnline();
  const isPendingRegistration = !user.role_id;

  const handleRoleChange = (roleId) => {
    // Role changes and account activation/deactivation are ONLINE
    // REQUIRED — see lib/offline/online-required.js.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await updateUserRole(user.id, roleId);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleToggle = () => {
    if (isSelf) return;
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    const next = user.status !== "active";
    if (next && isPendingRegistration) {
      setError("Pick a role for this person before activating their account.");
      return;
    }
    if (!next && !confirm(`Deactivate ${user.name}? They'll be signed out and unable to log back in until reactivated.`)) return;
    setError("");
    startTransition(async () => {
      const res = await toggleUserStatus(user.id, next);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 font-medium text-ink">{user.name}{isSelf && <span className="text-xs text-slate-400 ml-2">(you)</span>}</td>
        <td className="px-4 py-3 text-slate-600">{user.email}</td>
        <td className="px-4 py-3">
          <select
            defaultValue={user.role_id || ""}
            onChange={(e) => handleRoleChange(e.target.value)}
            disabled={pending || isSelf || !online}
            className="border border-slate-300 rounded-lg px-2 py-1 text-sm disabled:opacity-60"
          >
            {isPendingRegistration && <option value="" disabled>— Pick a role —</option>}
            {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </td>
        <td className="px-4 py-3 text-slate-600">{user.teacher_name || "—"}</td>
        <td className="px-4 py-3">
          {isPendingRegistration ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">pending registration</span>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full ${user.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
              {user.status}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <button onClick={handleToggle} disabled={pending || isSelf || !online} className="text-xs text-brick disabled:opacity-40 disabled:cursor-not-allowed">
            {isSelf ? "—" : user.status === "active" ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>
      {!online && (
        <tr><td colSpan={6} className="px-4 pb-2 pt-0">
          <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 inline-block">
            🔒 {ONLINE_REQUIRED_MESSAGE}
          </p>
        </td></tr>
      )}
      {error && (
        <tr><td colSpan={6} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
