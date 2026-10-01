"use client";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// What a cashier sees the instant an offline payment is saved. Deliberately
// styled nothing like Receipt.js's "✓ Payment Successful" — amber, not
// green; "PENDING SYNC", not a receipt number; no print/download buttons,
// because there is nothing final here yet to print. It becomes a real,
// printable Receipt.js once sync-engine.js confirms it — see
// OfflineFeeReceipts.js, which is where that confirmation shows up.
export default function OfflineReceiptStatus({ record, onClose }) {
  const rows = [
    ["Local Receipt", record.local_receipt_no],
    ["Student", record.studentName || record.student_id],
    ["Amount Received", fmt(record.amount)],
    ["Method", record.method],
    ["Remarks", record.remarks || "—"],
  ];

  return (
    <div className="bg-white border border-amber-200 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <div className="text-amber-700 text-lg font-semibold">🟠 Saved Locally</div>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Not yet a confirmed receipt — this will sync automatically once the device is back online.
      </p>

      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-2 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="font-medium text-ink text-right">{value}</span>
          </div>
        ))}
        <div className="flex justify-between px-4 py-2 text-sm bg-amber-50">
          <span className="text-amber-700 font-medium">Status</span>
          <span className="font-semibold text-amber-700 text-right">Pending Sync</span>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Hand the local receipt number to the parent as a reference for now. Check the Offline Receipts
        list below once you're back online to see it confirmed with a real receipt number.
      </p>

      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg bg-royal text-white ml-auto">
          Record Another Payment
        </button>
      </div>
    </div>
  );
}
