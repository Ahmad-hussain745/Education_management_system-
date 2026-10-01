"use client";

import { useState, useEffect, useTransition } from "react";
import { getBillPreview } from "./actions";
import { paymentRepository } from "@/lib/repositories/paymentRepository";
import Receipt from "./Receipt";
import OfflineReceiptStatus from "./OfflineReceiptStatus";
import StudentPicker from "@/components/StudentPicker";
import { subscribeConnectivity } from "@/lib/offline/connectivity";
import { getCachedBill, getBillFreshnessHours } from "@/lib/offline/repositories/fees";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function fmtBalance(n) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `Credit Rs. ${Math.abs(v).toLocaleString("en-US")}` : fmt(v);
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function PaymentEntryForm({ initialStudentId = "", initialStudentName = "", instituteId, collectedByName = "" }) {
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [bill, setBill] = useState(null);
  const [billStaleHours, setBillStaleHours] = useState(0);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [remarks, setRemarks] = useState("");
  const [isAdvance, setIsAdvance] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [offlineReceipt, setOfflineReceipt] = useState(null);
  const [loadingBill, startLoadingBill] = useTransition();
  const [saving, startSaving] = useTransition();

  // Generated once per bill — the moment a student's bill loads, not on
  // every render or every click of Save. That's what makes it useful: if
  // the connection drops mid-save and the cashier presses Save again for
  // the SAME bill, this stays the same key, so recordPayment() (see that
  // file) recognizes it as a retry instead of a second payment. A truly
  // new payment (a different student, or this same student's bill reloaded
  // after a successful save clears the form below) gets a fresh key,
  // because handleStudentChange regenerates it. Offline saves generate
  // their own separate key inside collectPaymentOffline() instead — this
  // one is only ever used on the online path.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const remaining = bill ? Number(bill.total_payable) - Number(bill.paid_total) : 0;
  const exceedsRemaining = bill && Number(amount) > remaining;

  const [online, setOnline] = useState(true);
  useEffect(() => subscribeConnectivity(setOnline), []);

  const handleStudentChange = (id, name = "") => {
    setStudentId(id);
    setStudentName(name);
    setBill(null);
    setBillStaleHours(0);
    setAmount("");
    setIsAdvance(false);
    setError("");
    setReceipt(null);
    setOfflineReceipt(null);
    setIdempotencyKey(crypto.randomUUID());
    if (!id) return;
    startLoadingBill(async () => {
      if (online) {
        const res = await getBillPreview(id);
        if (res?.error) {
          setError(res.error);
          return;
        }
        setBill(res.record);
        const rem = Math.max(0, Number(res.record.total_payable) - Number(res.record.paid_total));
        setAmount(rem > 0 ? String(rem) : "");
        return;
      }

      // Offline: no RPC to auto-generate this month's bill if it doesn't
      // exist yet (get_or_create_fee_record() needs a connection) — only
      // ever reads whatever was already cached the last time this device
      // synced while online. See lib/offline/repositories/fees.js.
      if (!instituteId) {
        setError("Can't look up a cached bill — institute context missing.");
        return;
      }
      const month = currentMonthStr();
      const cached = await getCachedBill(instituteId, id, month);
      const staleHours = await getBillFreshnessHours(instituteId);
      setBillStaleHours(staleHours);
      if (!cached) {
        setError("No cached bill for this student's current month. Sync while online at least once, then try again — or collect this payment once you're back online.");
        return;
      }
      setBill(cached);
      const rem = Math.max(0, Number(cached.total_payable) - Number(cached.paid_total));
      setAmount(rem > 0 ? String(rem) : "");
    });
  };

  // Arriving from Global Search's "Collect Fee" already names the student
  // — load their bill immediately instead of making the cashier pick again.
  useEffect(() => {
    if (initialStudentId) handleStudentChange(initialStudentId, initialStudentName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStudentId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    setReceipt(null);
    setOfflineReceipt(null);

    // Quick client-side check for instant feedback — the repository
    // re-checks this regardless (against a fresh server read when online,
    // against the cached bill when offline), and either the database
    // trigger (online) or collectPaymentOffline() (offline) enforces it
    // either way.
    if (Number(amount) > remaining && !isAdvance) {
      setError(`${fmt(amount)} exceeds the remaining balance of ${fmt(remaining)}. Tick "This is an advance payment" to collect it anyway.`);
      return;
    }
    if (!online && isAdvance) {
      setError('Advance payments need a connection — tick "This is an advance payment" only once you\'re back online.');
      return;
    }

    startSaving(async () => {
      try {
        const res = await paymentRepository.create({
          instituteId,
          feeRecordId: bill.id,
          studentId,
          month: bill.month,
          amount,
          method,
          remarks,
          isAdvance,
          idempotencyKey,
          bill,
          collectedBy: collectedByName,
        });

        if (res.mode === "blocked") {
          setError(res.error);
          return;
        }
        if (res.mode === "online") {
          if (res.error) {
            setError(res.error);
            return;
          }
          setReceipt(res.receipt);
        } else {
          // mode === "offline"
          setOfflineReceipt({ ...res.record, studentName });
        }
        setStudentId("");
        setStudentName("");
        setBill(null);
        setAmount("");
        setRemarks("");
      } catch (err) {
        // A network failure here (connection dropped mid-request, online
        // branch only — the offline branch never touches the network)
        // means we genuinely don't know whether the insert reached the
        // server — deliberately do NOT generate a new idempotencyKey on
        // this path. The button re-enables (startSaving's pending flag
        // clears once this promise settles either way) and a retry reuses
        // the same key, so if the first attempt actually did succeed
        // server-side, the retry returns that same payment instead of
        // creating another.
        setError("Couldn't reach the server — check your connection and press Record Payment again. It's safe to retry.");
      }
    });
  };

  if (receipt) {
    return <Receipt receipt={receipt} onClose={() => setReceipt(null)} />;
  }
  if (offlineReceipt) {
    return <OfflineReceiptStatus record={offlineReceipt} onClose={() => setOfflineReceipt(null)} />;
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-4">
      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm font-medium">
          🟠 Offline — payments collected now are saved locally as provisional (capped at the cached
          balance, no advance payments) and confirmed automatically once you're back online.
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
        <StudentPicker
          initialName={initialStudentName}
          placeholder="Search student by name or ID…"
          instituteId={instituteId}
          onSelect={(s) => handleStudentChange(s?.id || "", s?.name || "")}
        />
      </div>

      {loadingBill && <p className="text-sm text-slate-400">Loading this month's bill…</p>}

      {bill && !loadingBill && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Monthly Fee</span><span className="font-mono">{fmt(bill.monthly_fee)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Previous Balance</span><span className="font-mono">{fmt(bill.previous_balance)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="font-mono">− {fmt(bill.discount)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-medium"><span>Total Payable</span><span className="font-mono">{fmt(bill.total_payable)}</span></div>
          <div className="flex justify-between text-sage"><span>Already Paid</span><span className="font-mono">{fmt(bill.paid_total)}</span></div>
          <div className="flex justify-between font-semibold"><span>Remaining</span><span className="font-mono">{fmtBalance(remaining)}</span></div>
          {!online && (
            <p className="text-xs text-amber-600 pt-1">
              Cached {billStaleHours < 1 ? "less than an hour" : `${Math.floor(billStaleHours)}h`} ago
              {billStaleHours > 24 ? " — too old to collect against; sync first." : "."}
            </p>
          )}
        </div>
      )}

      {/* A genuine Rs. 0 total_payable is either a real fee waiver or —
          much more often — nobody has set up a fee structure for this
          student's class (or a student-specific override) yet. Say so
          plainly instead of leaving the cashier staring at "Maximum Rs. 0"
          with no explanation. */}
      {bill && !loadingBill && Number(bill.monthly_fee) <= 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
          <p className="font-medium">No payable fee found for this month.</p>
          <p className="mt-1">
            Check that this student's class has a fee structure set up (Fees → Fee Structure),
            or that a student-specific override exists (Fees → Student Fee Override) — unless this
            student genuinely has a waived/free fee, in which case this is expected.
          </p>
        </div>
      )}

      {bill && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount Received (Rs.)</label>
            <input
              type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">Currently due: {fmtBalance(remaining)}</p>
            {exceedsRemaining && online && (
              <label className="mt-2 flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">
                <input
                  type="checkbox"
                  checked={isAdvance}
                  onChange={(e) => setIsAdvance(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  This is an advance payment — {fmt(amount)} is more than the {fmt(remaining)} currently due.
                  The extra {fmt(Number(amount) - remaining)} will show as credit and reduce next month's bill.
                </span>
              </label>
            )}
            {exceedsRemaining && !online && (
              <p className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">
                {fmt(amount)} is more than the {fmt(remaining)} currently due. Advance payments can't be
                collected offline — connect first, or lower the amount to {fmt(remaining)}.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {["Cash", "Bank Transfer", "Cheque", "Easypaisa", "JazzCash", "Card"].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Remarks (optional)</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-brick">{error}</p>}

      {bill && (
        <button
          type="submit"
          disabled={saving || (exceedsRemaining && (!isAdvance || !online)) || (!online && billStaleHours > 24)}
          className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {saving ? "Saving…" : online ? "Record Payment" : "Save Locally (Offline)"}
        </button>
      )}
    </form>
  );
}
