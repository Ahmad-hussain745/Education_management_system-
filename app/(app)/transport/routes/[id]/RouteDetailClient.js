"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateRoute, addStop, removeStop, unassignStudent } from "../../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";
function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = Number(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function RouteDetailClient({ route, stops, assignments, vehicles, drivers }) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(route.vehicle_id || "");
  const [driverId, setDriverId] = useState(route.driver_id || "");
  const [status, setStatus] = useState(route.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function saveOverview() {
    setPending(true);
    setError(null);
    try {
      const res = await updateRoute(route.id, { name: route.name, description: route.description, vehicleId: vehicleId || null, driverId: driverId || null, status });
      if (res.error) setError(res.error);
      else router.refresh();
    } finally { setPending(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{route.name}</h1>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${status === "active" ? "bg-sage-tint text-sage" : "bg-slate-100 text-slate-500"}`}>{status}</span>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Vehicle &amp; Driver</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className={labelCls}>Vehicle
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_no} ({v.capacity} seats)</option>)}
            </select>
          </label>
          <label className={labelCls}>Driver
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className={labelCls}>Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
        <button onClick={saveOverview} disabled={pending} className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
      </section>

      <StopsSection routeId={route.id} stops={stops} />

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink mb-2">Assigned Students ({assignments.length})</h2>
        {assignments.length === 0 ? (
          <p className="text-sm text-slate-400">No students assigned to this route yet — use Assignments to add one.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {assignments.map((a) => (
              <AssignmentRow key={a.id} a={a} stops={stops} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StopsSection({ routeId, stops }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [dropTime, setDropTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!name.trim()) return;
    setPending(true); setError(null);
    try {
      const res = await addStop(routeId, { name, sequenceOrder: stops.length + 1, pickupTime: pickupTime || null, dropTime: dropTime || null });
      if (res.error) setError(res.error);
      else { setName(""); setPickupTime(""); setDropTime(""); router.refresh(); }
    } finally { setPending(false); }
  }

  async function remove(id) {
    await removeStop(id);
    router.refresh();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink">Stops</h2>
        <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Add Stop"}</button>
      </div>
      {show && (
        <div className="flex flex-wrap items-end gap-3 mb-3 bg-slate-50 rounded-lg p-3">
          <label className={labelCls}>Name<input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></label>
          <label className={labelCls}>Pickup<input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className={inputCls} /></label>
          <label className={labelCls}>Drop<input type="time" value={dropTime} onChange={(e) => setDropTime(e.target.value)} className={inputCls} /></label>
          <button onClick={submit} disabled={pending || !name.trim()} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-2 rounded-lg disabled:opacity-60">Add</button>
        </div>
      )}
      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}
      {stops.length === 0 ? (
        <p className="text-sm text-slate-400">No stops added yet.</p>
      ) : (
        <div className="space-y-1">
          {stops.map((s, i) => (
            <div key={s.id} className="flex items-center justify-between text-sm py-1">
              <span className="text-ink">{i + 1}. {s.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{fmtTime(s.pickup_time)}{s.drop_time ? ` / ${fmtTime(s.drop_time)}` : ""}</span>
                <button onClick={() => remove(s.id)} className="text-xs text-slate-400 hover:text-brick">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AssignmentRow({ a, stops }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function unassign() {
    setPending(true);
    try { await unassignStudent(a.student_id); router.refresh(); } finally { setPending(false); }
  }
  const stopName = stops.find((s) => s.id === a.stop_id)?.name;
  return (
    <div className="py-2.5 flex items-center justify-between text-sm">
      <span className="text-ink">{a.student?.name} <span className="text-xs text-slate-400">{a.student?.class?.name}{stopName ? ` · ${stopName}` : ""}</span></span>
      <button onClick={unassign} disabled={pending} className="text-xs text-slate-400 hover:text-brick">Unassign</button>
    </div>
  );
}
