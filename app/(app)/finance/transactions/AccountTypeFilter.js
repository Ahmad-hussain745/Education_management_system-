"use client";

import { useRouter } from "next/navigation";

export default function AccountTypeFilter({ searchParams, accountId, type, accounts, typeLabels }) {
  const router = useRouter();

  const setParam = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page"); // a filter change invalidates whatever page was showing
    router.push(`?${params.toString()}`);
  };

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Account</label>
        <select defaultValue={accountId} onChange={(e) => setParam("account_id", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
        <select defaultValue={type} onChange={(e) => setParam("type", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All types</option>
          {Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
    </>
  );
}
