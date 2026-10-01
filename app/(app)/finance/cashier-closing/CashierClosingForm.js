"use client";

import { useEffect, useState } from "react";
import { getCashierClosingSummary, closeCashierDay, listCashiers } from "./actions";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CashierClosingForm({ isCashier, selfId, selfName, canPickCashier }) {
  const [cashiers, setCashiers] = useState(canPickCashier ? null : [{ id: selfId, name: selfName }]);
  const [cashierId, setCashierId] = useState(isCashier ? selfId : "");
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [actualCash, setActualCash] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  // Finance staff/Principal pick which cashier's day they're looking at —
  // fetched via list_cashiers() (0024_daily_cashier_closing.sql) since a
  // Cashier picker built from a plain `users` query would come back empty
  // for anyone but Super Admin (users' own RLS only lets you read your own
  // row otherwise).
  useEffect(() => {
    if (!canPickCashier) return;
    (async () => {
      const res = await listCashiers();
      if (res?.data) {
        setCashiers(res.data);
        if (!cashierId && res.data.length > 0) setCashierId(res.data[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPickCashier]);

  useEffect(() => {
    if (!cashierId || !date) return;
    setLoadingSummary(true);
    setSummaryError("");
    setSuccess(false);
    (async () => {
      const res = await getCashierClosingSummary(cashierId, date);
      setLoadingSummary(false);
      if (res?.error) {
        setSummaryError(res.error);
        setSummary(null);
        return;
      }
      setSummary(res.data);
    })();
  }, [cashierId, date]);

  const expected = Number(summary?.expected_cash || 0);
  const actualNum = actualCash === "" ? null : Number(actualCash);
  const diff = actualNum === null ? null : actualNum - expected;
  const mismatched = diff !== null && diff !== 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData();
    formData.set("cashier_id", cashierId);
    formData.set("closing_date", date);
    formData.set("actual_cash", actualCash);
    formData.set("reason", reason);
    const res = await closeCashierDay(formData);
    setPending(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setSuccess(true);
    setActualCash("");
    setReason("");
    setSummary((s) => (s ? { ...s, already_closed: true } : s));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-xl">
      <div className="flex flex-wrap gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cashier</label>
          {canPickCashier ? (
            <select value={cashierId} onChange={(e) => setCashierId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              {(cashiers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {(!cashiers || cashiers.length === 0) && <option value="">No cashiers found</option>}
            </select>
          ) : (
            <div className="text-sm font-medium text-ink px-3 py-2 border border-slate-200 rounded-lg bg-slate-50">{selfName}</div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {loadingSummary && <p className="text-sm text-slate-400">Loading today's totals…</p>}
      {summaryError && <p className="text-sm text-brick">{summaryError}</p>}

      {summary && !loadingSummary && (
        <>
          <div className="border-t border-slate-100 pt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">Cash Collections</span><span className="font-mono">{fmt(summary.cash_collections)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Bank Collections</span><span className="font-mono text-slate-500">{fmt(summary.bank_collections)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">Other Income (cash)</span><span className="font-mono">{fmt(summary.other_income_cash)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-medium"><span>Expected Cash</span><span className="font-mono">{fmt(expected)}</span></div>
          </div>

          {summary.already_closed ? (
            <p className="text-sm text-slate-400 mt-4">This day is already closed for this cashier.</p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Actual Cash Counted</label>
                <input
                  type="number" min="0" step="0.01" required
                  value={actualCash} onChange={(e) => setActualCash(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="0.00"
                />
              </div>

              {diff !== null && (
                <div className={`text-sm font-medium ${diff === 0 ? "text-sage" : "text-brick"}`}>
                  {diff === 0 ? "Difference: Rs. 0 — matches exactly." : diff < 0
                    ? `Shortage: ${fmt(Math.abs(diff))}`
                    : `Overage: ${fmt(diff)}`}
                </div>
              )}

              {mismatched && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Reason (required — cash doesn't match)</label>
                  <textarea
                    required value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    rows={2} placeholder="e.g. gave change short by mistake, will make up tomorrow"
                  />
                </div>
              )}

              {error && <p className="text-sm text-brick">{error}</p>}
              {success && <p className="text-sm text-sage">Day closed.</p>}

              <button type="submit" disabled={pending || !cashierId} className="text-sm px-4 py-2 rounded-lg bg-royal text-white disabled:opacity-60">
                {pending ? "Closing…" : "Close Day"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
