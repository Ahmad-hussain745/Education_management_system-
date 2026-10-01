"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoute } from "../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";

export default function RouteForm({ vehicles, drivers }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    setPending(true);
    setError(null);
    try {
      const res = await createRoute({ name, description, vehicleId: vehicleId || null, driverId: driverId || null });
      if (res.error) setError(res.error);
      else router.push(`/transport/routes/${res.id}`);
    } finally {
      setPending(false);
    }
  }

  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-royal hover:underline">+ Add Route</button>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={`${labelCls} sm:col-span-2`}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Route North" className={inputCls} /></label>
        <label className={labelCls}>Vehicle (optional)
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_no}</option>)}
          </select>
        </label>
        <label className={labelCls}>Driver (optional)
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={`${labelCls} sm:col-span-2`}>Description (optional)<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} /></label>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Create Route"}</button>
        <button onClick={() => setShow(false)} className="text-sm text-slate-500">Cancel</button>
      </div>
    </div>
  );
}
