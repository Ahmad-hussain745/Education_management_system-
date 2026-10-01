"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateVehicle, addMaintenance, addFuelLog } from "../../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function rs(n) { return n == null ? "—" : "Rs. " + Math.round(Number(n)).toLocaleString("en-US"); }

const TABS = ["Overview", "Maintenance", "Fuel"];

export default function VehicleDetailClient({ vehicle, maintenance, fuelLogs, analytics }) {
  const [tab, setTab] = useState("Overview");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{vehicle.registration_no}</h1>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">{vehicle.vehicle_type} · {vehicle.capacity} seats{vehicle.odometer_reading ? ` · ${Math.round(vehicle.odometer_reading).toLocaleString()} km` : ""}</p>
        </div>
        {vehicle.insurance_expiry && vehicle.insurance_expiry < today && (
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-brick-tint text-brick">Insurance expired</span>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`text-sm px-3 py-2 border-b-2 -mb-px ${tab === t ? "border-royal text-royal font-medium" : "border-transparent text-slate-500 hover:text-ink"}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab vehicle={vehicle} />}
      {tab === "Maintenance" && <MaintenanceTab vehicleId={vehicle.id} maintenance={maintenance} />}
      {tab === "Fuel" && <FuelTab vehicleId={vehicle.id} fuelLogs={fuelLogs} analytics={analytics} />}
    </div>
  );
}

function OverviewTab({ vehicle }) {
  const router = useRouter();
  const [fields, setFields] = useState({
    registrationNo: vehicle.registration_no, vehicleType: vehicle.vehicle_type, make: vehicle.make || "", model: vehicle.model || "",
    year: vehicle.year || "", capacity: vehicle.capacity, insuranceExpiry: vehicle.insurance_expiry || "", fitnessExpiry: vehicle.fitness_expiry || "",
    status: vehicle.status,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setPending(true); setError(null);
    try {
      const res = await updateVehicle(vehicle.id, { ...fields, capacity: Number(fields.capacity), year: fields.year ? Number(fields.year) : null });
      if (res.error) setError(res.error);
      else router.refresh();
    } finally { setPending(false); }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <label className={labelCls}>Registration No.<input value={fields.registrationNo} onChange={set("registrationNo")} className={inputCls} /></label>
        <label className={labelCls}>Type
          <select value={fields.vehicleType} onChange={set("vehicleType")} className={inputCls}>{["bus", "van", "car", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label className={labelCls}>Capacity<input type="number" value={fields.capacity} onChange={set("capacity")} className={inputCls} /></label>
        <label className={labelCls}>Make<input value={fields.make} onChange={set("make")} className={inputCls} /></label>
        <label className={labelCls}>Model<input value={fields.model} onChange={set("model")} className={inputCls} /></label>
        <label className={labelCls}>Year<input type="number" value={fields.year} onChange={set("year")} className={inputCls} /></label>
        <label className={labelCls}>Insurance Expiry<input type="date" value={fields.insuranceExpiry} onChange={set("insuranceExpiry")} className={inputCls} /></label>
        <label className={labelCls}>Fitness Expiry<input type="date" value={fields.fitnessExpiry} onChange={set("fitnessExpiry")} className={inputCls} /></label>
        <label className={labelCls}>Status
          <select value={fields.status} onChange={set("status")} className={inputCls}>{["active", "maintenance", "inactive"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
      </div>
      {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
      <button onClick={save} disabled={pending} className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
    </div>
  );
}

function MaintenanceTab({ vehicleId, maintenance }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ maintenanceType: "service", description: "", serviceDate: new Date().toISOString().slice(0, 10), nextDueDate: "", cost: "", odometerReading: "", vendor: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setPending(true); setError(null);
    try {
      const res = await addMaintenance(vehicleId, { ...fields, cost: fields.cost || null, odometerReading: fields.odometerReading || null });
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Log Maintenance"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-3 gap-3">
          <label className={labelCls}>Type<select value={fields.maintenanceType} onChange={set("maintenanceType")} className={inputCls}>{["service", "repair", "inspection", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className={labelCls}>Service Date<input type="date" value={fields.serviceDate} onChange={set("serviceDate")} className={inputCls} /></label>
          <label className={labelCls}>Next Due (optional)<input type="date" value={fields.nextDueDate} onChange={set("nextDueDate")} className={inputCls} /></label>
          <label className={labelCls}>Cost (optional)<input type="number" value={fields.cost} onChange={set("cost")} className={inputCls} /></label>
          <label className={labelCls}>Odometer (optional)<input type="number" value={fields.odometerReading} onChange={set("odometerReading")} className={inputCls} /></label>
          <label className={labelCls}>Vendor (optional)<input value={fields.vendor} onChange={set("vendor")} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-3`}>Description<textarea value={fields.description} onChange={set("description")} rows={2} className={inputCls} /></label>
          {error && <div className="text-sm text-red-700 sm:col-span-3">{error}</div>}
          <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 sm:col-span-3 w-fit">{pending ? "Saving…" : "Save"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {maintenance.length === 0 ? <p className="text-sm text-slate-400 p-4">No maintenance logged yet.</p> : maintenance.map((m) => (
          <div key={m.id} className="p-3 text-sm">
            <div className="flex justify-between"><span className="capitalize font-medium text-ink">{m.maintenance_type}</span><span className="text-xs text-slate-400">{fmtDate(m.service_date)}</span></div>
            <div className="text-xs text-slate-400">{m.vendor ? `${m.vendor} · ` : ""}{rs(m.cost)}{m.next_due_date ? ` · next due ${fmtDate(m.next_due_date)}` : ""}</div>
            {m.description && <p className="text-xs text-slate-500 mt-1">{m.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function FuelTab({ vehicleId, fuelLogs, analytics }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ fuelDate: new Date().toISOString().slice(0, 10), liters: "", cost: "", odometerReading: "", notes: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!fields.liters || !fields.cost) { setError("Liters and cost are required."); return; }
    setPending(true); setError(null);
    try {
      const res = await addFuelLog(vehicleId, { ...fields, liters: Number(fields.liters), cost: Number(fields.cost), odometerReading: fields.odometerReading || null });
      if (res.error) setError(res.error);
      else { setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      {analytics && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Fuel Analytics — last 6 months</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div><div className="text-lg font-semibold font-mono text-ink">{analytics.total_liters ?? 0}L</div><div className="text-xs text-slate-400">total fuel</div></div>
            <div><div className="text-lg font-semibold font-mono text-ink">{rs(analytics.total_cost)}</div><div className="text-xs text-slate-400">total spend</div></div>
            <div><div className="text-lg font-semibold font-mono text-ink">{rs(analytics.avg_cost_per_liter)}</div><div className="text-xs text-slate-400">per liter</div></div>
            <div><div className="text-lg font-semibold font-mono text-ink">{analytics.mileage_km_per_liter ?? "—"}</div><div className="text-xs text-slate-400">km/liter{analytics.mileage_km_per_liter == null ? " (needs 2+ odometer readings)" : ""}</div></div>
          </div>
        </section>
      )}
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Log Fuel"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-3 gap-3">
          <label className={labelCls}>Date<input type="date" value={fields.fuelDate} onChange={set("fuelDate")} className={inputCls} /></label>
          <label className={labelCls}>Liters<input type="number" value={fields.liters} onChange={set("liters")} className={inputCls} /></label>
          <label className={labelCls}>Cost<input type="number" value={fields.cost} onChange={set("cost")} className={inputCls} /></label>
          <label className={labelCls}>Odometer (optional)<input type="number" value={fields.odometerReading} onChange={set("odometerReading")} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Notes (optional)<input value={fields.notes} onChange={set("notes")} className={inputCls} /></label>
          {error && <div className="text-sm text-red-700 sm:col-span-3">{error}</div>}
          <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 sm:col-span-3 w-fit">{pending ? "Saving…" : "Save"}</button>
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {fuelLogs.length === 0 ? <p className="text-sm text-slate-400 p-4">No fuel logged yet.</p> : fuelLogs.map((f) => (
          <div key={f.id} className="p-3 flex justify-between text-sm">
            <span className="text-ink">{fmtDate(f.fuel_date)} · {f.liters}L{f.odometer_reading ? ` · ${Math.round(f.odometer_reading).toLocaleString()} km` : ""}</span>
            <span className="font-mono text-ink">{rs(f.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
