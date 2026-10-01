"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewMyLeave, applyMyLeave, cancelMyLeave, decideLeaveRequest } from "./actions";

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function monthLabel(m) {
  return new Date(m + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function rs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

const STATUS_STYLE = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-sage-tint text-sage",
  rejected: "bg-brick-tint text-brick",
  cancelled: "bg-slate-100 text-slate-500",
};

const inputCls = "mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm";

// The same numbers an approver sees: how many days are paid vs. unpaid
// (a paid type's days past its annual quota become unpaid), and what
// payroll's own rule will deduct for the unpaid ones. An estimate — the
// real amount is whatever payroll's draft computes.
function ImpactSummary({ impact }) {
  if (!impact) return null;
  const stateHint = {
    locked: "payroll for this month is already closed, so this won't be deducted automatically",
    draft: "a payroll draft exists — it needs a refresh to include this",
    not_generated: "",
  };
  return (
    <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
      <div>
        <strong>{impact.working_days}</strong> working day{impact.working_days === 1 ? "" : "s"} (Sundays excluded):{" "}
        <strong className="text-sage">{impact.paid_days} paid</strong>, <strong className={impact.unpaid_days > 0 ? "text-brick" : ""}>{impact.unpaid_days} unpaid</strong>.
      </div>
      {impact.unpaid_days > 0 && impact.payroll_applicable && impact.months.map((m) => (
        <div key={m.month}>
          {monthLabel(m.month)}: {m.unpaid_days} day{m.unpaid_days === 1 ? "" : "s"} × {rs(m.day_rate)} ≈ <strong>{rs(m.estimated_deduction)}</strong> salary deduction
          {stateHint[m.payroll_state] ? <span className="text-amber-700"> — {stateHint[m.payroll_state]}</span> : null}
        </div>
      ))}
      {impact.unpaid_days > 0 && !impact.payroll_applicable && impact.note && <div className="text-slate-500">{impact.note}</div>}
    </div>
  );
}

export default function LeaveClient({ me, balances, types, requests, inbox, year }) {
  return (
    <div className="space-y-6">
      <Balances balances={balances} year={year} />
      <ApplyForm types={types} />
      <MyRequests requests={requests} />
      {me.is_supervisor && <Inbox inbox={inbox} />}
    </div>
  );
}

function Balances({ balances, year }) {
  if (balances.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink mb-2">Balances — {year}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {balances.map((b) => (
          <div key={b.leave_type_id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">{b.leave_type_name}</div>
            <div className="text-xl font-semibold font-mono text-ink mt-1">
              {!b.is_paid ? "—" : b.remaining === null ? "No limit" : `${b.remaining} left`}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {!b.is_paid ? "Unpaid — always deducted" : b.annual_quota === null ? `${b.days_taken} taken` : `${b.paid_days_used} of ${b.annual_quota} used`}
              {b.pending_days > 0 ? ` · ${b.pending_days} pending` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApplyForm({ types }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const latest = useRef(0);

  // Live preview as the dates/type change. `latest` discards a slow
  // response that arrives after a newer one was already requested.
  useEffect(() => {
    setImpact(null);
    setPreviewError(null);
    if (!from || !to || to < from) return;
    const ticket = ++latest.current;
    previewMyLeave(typeId || null, from, to).then((res) => {
      if (ticket !== latest.current) return;
      if (res.error) setPreviewError(res.error);
      else setImpact(res.impact);
    });
  }, [typeId, from, to]);

  async function submit() {
    if (!from || !to) { setError("Choose a date range."); return; }
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await applyMyLeave(typeId || null, from, to, reason);
      if (res.error) setError(res.error);
      else { setDone(true); setFrom(""); setTo(""); setReason(""); router.refresh(); }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-ink mb-3">Request Leave</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs text-slate-600">
          Type
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? "" : " (unpaid)"}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-slate-600">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <label className="text-xs text-slate-600 sm:col-span-3">
          Reason (optional)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputCls} />
        </label>
      </div>
      <div className="mt-3"><ImpactSummary impact={impact} /></div>
      {previewError && <div className="text-xs text-red-700 mt-2">{previewError}</div>}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</div>}
      {done && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-3">Request sent.</div>}
      <button onClick={submit} disabled={pending || !from || !to} className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Sending…" : "Submit Request"}
      </button>
    </section>
  );
}

function MyRequests({ requests }) {
  const router = useRouter();
  const [error, setError] = useState(null);

  async function cancel(id) {
    setError(null);
    const res = await cancelMyLeave(id);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink mb-2">My Requests</h2>
      {error && <div className="text-sm text-red-700 mb-2">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {requests.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">No leave requests yet.</p>
        ) : requests.map((r) => (
          <div key={r.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-ink">{r.leave_type?.name || "Leave"}</span>
                <span className="text-xs text-slate-400 ml-2">{fmtDate(r.date_from)} – {fmtDate(r.date_to)} · {r.days_count} day{r.days_count === 1 ? "" : "s"}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
            </div>
            {r.status === "approved" && (
              <p className="text-xs text-slate-500 mt-1">{r.days_paid} paid{r.days_unpaid > 0 ? `, ${r.days_unpaid} unpaid` : ""}</p>
            )}
            {r.payroll_note && <p className="text-xs text-amber-700 mt-1">{r.payroll_note}</p>}
            {r.decision_note && <p className="text-xs text-slate-500 mt-1">Note: {r.decision_note}</p>}
            {r.status === "pending" && (
              <button onClick={() => cancel(r.id)} className="text-xs text-slate-500 hover:text-brick mt-2">Cancel request</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Inbox({ inbox }) {
  const pending = inbox.filter((r) => r.status === "pending");
  const decided = inbox.filter((r) => r.status !== "pending");
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink mb-2">
        Awaiting My Decision{pending.length > 0 ? ` (${pending.length})` : ""}
      </h2>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400 p-4">Nothing waiting on you.</p>
        ) : pending.map((r) => <InboxCard key={r.id} r={r} />)}
      </div>

      {decided.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-slate-500 mt-4 mb-2">Recently decided</h3>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {decided.map((r) => (
              <div key={r.id} className="p-3 flex items-center justify-between gap-3">
                <div className="text-sm text-ink">
                  {r.employee_name} <span className="text-xs text-slate-400">· {r.leave_type_name || "Leave"} · {fmtDate(r.date_from)} – {fmtDate(r.date_to)}</span>
                  {r.payroll_note && <p className="text-xs text-amber-700 mt-0.5">{r.payroll_note}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function InboxCard({ r }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function decide(status) {
    setPending(true);
    setError(null);
    try {
      const res = await decideLeaveRequest(r.id, status, note);
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p-4 space-y-2">
      <div>
        <span className="text-sm font-medium text-ink">{r.employee_name}</span>
        <span className="text-xs text-slate-400 ml-2">
          {r.leave_type_name || "Leave"}{r.is_paid === false ? " (unpaid)" : ""} · {fmtDate(r.date_from)} – {fmtDate(r.date_to)}
        </span>
      </div>
      {r.reason && <p className="text-xs text-slate-500">{r.reason}</p>}
      <ImpactSummary impact={r.impact} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
      {error && <div className="text-xs text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button onClick={() => decide("approved")} disabled={pending} className="text-xs bg-sage text-white px-3 py-1.5 rounded-lg disabled:opacity-60">Approve</button>
        <button onClick={() => decide("rejected")} disabled={pending} className="text-xs border border-slate-300 px-3 py-1.5 rounded-lg disabled:opacity-60">Reject</button>
      </div>
    </div>
  );
}
