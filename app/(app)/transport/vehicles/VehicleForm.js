"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createVehicle } from "../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";

export default function VehicleForm() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ registrationNo: "", vehicleType: "bus", make: "", model: "", year: "", capacity: "", insuranceExpiry: "", fitnessExpiry: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!fields.registrationNo.trim() || !fields.capacity) { setError("Registration number and capacity are required."); return; }
    setPending(true); setError(null);
    try {
      const res = await createVehicle({ ...fields, capacity: Number(fields.capacity), year: fields.year ? Number(fields.year) : null });
      if (res.error) setError(res.error);
      else router.push(`/transport/vehicles/${res.id}`);
    } finally { setPending(false); }
  }

  if (!show) return <button onClick={() => setShow(true)} className="text-xs text-royal hover:underline">+ Add Vehicle</button>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <label className={labelCls}>Registration No.<input value={fields.registrationNo} onChange={set("registrationNo")} className={inputCls} /></label>
        <label className={labelCls}>Type
          <select value={fields.vehicleType} onChange={set("vehicleType")} className={inputCls}>
            {["bus", "van", "car", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className={labelCls}>Capacity<input type="number" value={fields.capacity} onChange={set("capacity")} className={inputCls} /></label>
        <label className={labelCls}>Make<input value={fields.make} onChange={set("make")} className={inputCls} /></label>
        <label className={labelCls}>Model<input value={fields.model} onChange={set("model")} className={inputCls} /></label>
        <label className={labelCls}>Year<input type="number" value={fields.year} onChange={set("year")} className={inputCls} /></label>
        <label className={labelCls}>Insurance Expiry<input type="date" value={fields.insuranceExpiry} onChange={set("insuranceExpiry")} className={inputCls} /></label>
        <label className={labelCls}>Fitness Expiry<input type="date" value={fields.fitnessExpiry} onChange={set("fitnessExpiry")} className={inputCls} /></label>
      </div>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Add Vehicle"}</button>
        <button onClick={() => setShow(false)} className="text-sm text-slate-500">Cancel</button>
      </div>
    </div>
  );
}
