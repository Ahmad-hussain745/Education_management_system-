"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDriver, updateDriver } from "../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—"; }

export default function DriversClient({ drivers, employees }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [fields, setFields] = useState({ name: "", phone: "", licenseNo: "", licenseExpiry: "", address: "", employeeId: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  function pickEmployee(id) {
    set("employeeId")({ target: { value: id } });
    const emp = employees.find((e) => e.id === id);
    if (emp && !fields.name) setFields((f) => ({ ...f, name: emp.name, employeeId: id }));
  }

  async function submit() {
    if (!fields.name.trim()) { setError("Name is required."); return; }
    setPending(true); setError(null);
    try {
      const res = await createDriver({ ...fields, employeeId: fields.employeeId || null });
      if (res.error) setError(res.error);
      else { setFields({ name: "", phone: "", licenseNo: "", licenseExpiry: "", address: "", employeeId: "" }); setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "+ Add Driver"}</button>
      {show && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-2 gap-3">
          <label className={labelCls}>Link to HR employee (optional)
            <select value={fields.employeeId} onChange={(e) => pickEmployee(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div />
          <label className={labelCls}>Name<input value={fields.name} onChange={set("name")} className={inputCls} /></label>
          <label className={labelCls}>Phone<input value={fields.phone} onChange={set("phone")} className={inputCls} /></label>
          <label className={labelCls}>License No.<input value={fields.licenseNo} onChange={set("licenseNo")} className={inputCls} /></label>
          <label className={labelCls}>License Expiry<input type="date" value={fields.licenseExpiry} onChange={set("licenseExpiry")} className={inputCls} /></label>
          <label className={`${labelCls} sm:col-span-2`}>Address<input value={fields.address} onChange={set("address")} className={inputCls} /></label>
          {error && <div className="text-sm text-red-700 sm:col-span-2">{error}</div>}
          <button onClick={submit} disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 sm:col-span-2 w-fit">{pending ? "Saving…" : "Add Driver"}</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {drivers.length === 0 ? <p className="text-sm text-slate-400 p-4">No drivers yet.</p> : drivers.map((d) => <DriverRow key={d.id} driver={d} today={today} />)}
      </div>
    </div>
  );
}

function DriverRow({ driver, today }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({ name: driver.name, phone: driver.phone || "", licenseNo: driver.license_no || "", licenseExpiry: driver.license_expiry || "", address: driver.address || "", status: driver.status });
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const expired = driver.license_expiry && driver.license_expiry < today;

  async function save() {
    setPending(true);
    try { await updateDriver(driver.id, fields); setEditing(false); router.refresh(); } finally { setPending(false); }
  }

  if (!editing) {
    return (
      <div className="p-4 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-ink">{driver.name}</span>
          <div className="text-xs text-slate-400 mt-0.5">
            {driver.phone || "—"}{driver.license_expiry ? ` · License exp. ${fmtDate(driver.license_expiry)}` : ""}
            {expired && <span className="text-brick font-medium"> · expired</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${driver.status === "active" ? "bg-sage-tint text-sage" : "bg-slate-100 text-slate-500"}`}>{driver.status}</span>
          <button onClick={() => setEditing(true)} className="text-xs text-royal hover:underline">Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 grid sm:grid-cols-2 gap-3">
      <label className={labelCls}>Name<input value={fields.name} onChange={set("name")} className={inputCls} /></label>
      <label className={labelCls}>Phone<input value={fields.phone} onChange={set("phone")} className={inputCls} /></label>
      <label className={labelCls}>License No.<input value={fields.licenseNo} onChange={set("licenseNo")} className={inputCls} /></label>
      <label className={labelCls}>License Expiry<input type="date" value={fields.licenseExpiry} onChange={set("licenseExpiry")} className={inputCls} /></label>
      <label className={labelCls}>Status<select value={fields.status} onChange={set("status")} className={inputCls}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <div className="flex items-end gap-2">
        <button onClick={save} disabled={pending} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
        <button onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
      </div>
    </div>
  );
}
