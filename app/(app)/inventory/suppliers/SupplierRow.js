"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSupplier, toggleSupplierStatus, deleteSupplier } from "./actions";

export default function SupplierRow({ supplier }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone || "");
  const [address, setAddress] = useState(supplier.address || "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", supplier.id);
    formData.set("name", name);
    formData.set("phone", phone);
    formData.set("address", address);
    startTransition(async () => {
      const res = await updateSupplier(formData);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleToggle = () => {
    setError("");
    startTransition(async () => {
      const res = await toggleSupplierStatus(supplier.id, supplier.active !== true);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${supplier.name}"? This can't be undone.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteSupplier(supplier.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <tr className="border-t border-slate-100">
        <td className="px-4 py-2" colSpan={4}>
          <form onSubmit={handleSave} className="flex items-center gap-2 flex-wrap">
            <input value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1 min-w-[10rem]" placeholder="Name" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-36" placeholder="Phone" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1 min-w-[10rem]" placeholder="Address" />
            <button type="submit" disabled={pending} className="text-sm px-3 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm px-2 py-1 text-slate-500">Cancel</button>
          </form>
          {error && <p className="text-sm text-brick mt-1">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-4 py-3 font-medium text-ink">{supplier.name}</td>
        <td className="px-4 py-3 text-slate-600">{supplier.phone || "—"}</td>
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${supplier.active ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
            {supplier.active ? "active" : "inactive"}
          </span>
        </td>
        <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
          <button onClick={() => setEditing(true)} className="text-xs text-royal">Edit</button>
          <button onClick={handleToggle} disabled={pending} className="text-xs text-slate-500">
            {supplier.active ? "Deactivate" : "Activate"}
          </button>
          <button onClick={handleDelete} disabled={pending} className="text-xs text-brick">Delete</button>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={4} className="px-4 pb-2 pt-0"><p className="text-sm text-brick">{error}</p></td></tr>
      )}
    </>
  );
}
