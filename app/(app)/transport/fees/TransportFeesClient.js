"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setTransportFeeStructure, previewTransportFees, generateTransportFees, recordTransportPayment } from "../actions";

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";
const labelCls = "text-xs text-slate-600";
function rs(n) { return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US"); }
const STATUS_COLOR = { paid: "text-sage", partial: "text-amber-700", unpaid: "text-brick" };

export default function TransportFeesClient({ routes, feeStructures, initialRecords, currentMonth }) {
  return (
    <div className="space-y-6">
      <RouteFeeSetup routes={routes} feeStructures={feeStructures} />
      <GenerateSection month={currentMonth} />
      <RecordsList records={initialRecords} month={currentMonth} />
    </div>
  );
}

function RouteFeeSetup({ routes, feeStructures }) {
  const router = useRouter();
  const feeByRoute = new Map(feeStructures.filter((f) => f.route_id).map((f) => [f.route_id, f.monthly_fee]));
  const [edits, setEdits] = useState({});
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  async function save(routeId) {
    const value = edits[routeId];
    if (!value) return;
    setPending(routeId); setError(null);
    try {
      const res = await setTransportFeeStructure({ routeId, monthlyFee: Number(value) });
      if (res.error) setError(res.error);
      else router.refresh();
    } finally { setPending(null); }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-ink mb-3">Route Monthly Fee</h2>
      {error && <div className="text-sm text-red-700 mb-2">{error}</div>}
      <div className="space-y-2">
        {routes.map((r) => (
          <div key={r.id} className="flex items-center gap-3">
            <span className="text-sm text-ink flex-1">{r.name}</span>
            <input type="number" defaultValue={feeByRoute.get(r.id) || ""} placeholder="e.g. 2000"
              onChange={(e) => setEdits((ed) => ({ ...ed, [r.id]: e.target.value }))}
              className="w-32 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <button onClick={() => save(r.id)} disabled={pending === r.id || !edits[r.id]} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
              {pending === r.id ? "…" : "Save"}
            </button>
          </div>
        ))}
        {routes.length === 0 && <p className="text-sm text-slate-400">No active routes yet.</p>}
      </div>
    </section>
  );
}

function GenerateSection({ month }) {
  const router = useRouter();
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function loadPreview() {
    setPending(true); setError(null);
    try {
      const res = await previewTransportFees(month);
      if (res.error) setError(res.error);
      else setPreview(res.preview);
    } finally { setPending(false); }
  }

  async function generate() {
    setPending(true); setError(null);
    try {
      const res = await generateTransportFees(month);
      if (res.error) setError(res.error);
      else { setResult(res.result); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-ink mb-1">Generate — {new Date(month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
      <div className="flex gap-2 mt-2">
        <button onClick={loadPreview} disabled={pending} className="text-xs border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg disabled:opacity-60">Preview</button>
        <button onClick={generate} disabled={pending} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">Generate</button>
      </div>
      {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
      {preview && (
        <p className="text-xs text-slate-500 mt-2">
          {preview.assigned_students} student{preview.assigned_students === 1 ? "" : "s"} currently assigned ·
          {" "}{preview.already_generated} already billed this month · {preview.to_generate} to generate ·
          {" "}expected {rs(preview.expected_amount)}
        </p>
      )}
      {result && <p className="text-xs text-sage mt-2">Generated {result.generated_count}, skipped {result.skipped_count} already-billed. Total {rs(result.total_expected)}.</p>}
    </section>
  );
}

function RecordsList({ records, month }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink mb-2">This Month's Bills ({records.length})</h2>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {records.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Nothing generated for this month yet.</p>
        ) : records.map((r) => <RecordRow key={r.id} record={r} month={month} />)}
      </div>
    </section>
  );
}

function RecordRow({ record, month }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function pay() {
    if (!amount) return;
    setPending(true); setError(null);
    try {
      const res = await recordTransportPayment(record.id, record.student_id, month, Number(amount), "Cash", null);
      if (res.error) setError(res.error);
      else { setAmount(""); setShow(false); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-ink">{record.student?.name}</span>
          <span className="text-xs text-slate-400 ml-2">{record.student?.class?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500">{rs(record.paid_total)} / {rs(record.total_payable)}</span>
          <span className={`text-xs font-medium capitalize ${STATUS_COLOR[record.status]}`}>{record.status}</span>
          {record.status !== "paid" && <button onClick={() => setShow((v) => !v)} className="text-xs text-royal hover:underline">{show ? "Cancel" : "Pay"}</button>}
        </div>
      </div>
      {show && (
        <div className="flex items-center gap-2 mt-2">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className="w-32 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
          <button onClick={pay} disabled={pending || !amount} className="text-xs bg-sage text-white px-3 py-1.5 rounded-lg disabled:opacity-60">{pending ? "…" : "Record Payment"}</button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      )}
    </div>
  );
}
