"use client";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
// A negative balance means the student has credit (an advance payment
// covering more than was due) — show it as "Credit" rather than a
// confusing negative rupee figure.
function fmtBalance(n) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `Credit Rs. ${Math.abs(v).toLocaleString("en-US")}` : fmt(v);
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function Receipt({ receipt, onClose }) {
  const rows = [
    ["Receipt No", receipt.receiptNo],
    ["Student", receipt.studentName + (receipt.studentCode ? ` (${receipt.studentCode})` : "")],
    ["Class", receipt.className || "—"],
    ["Month", monthLabel(receipt.month)],
    ["Previous Balance", fmt(receipt.previousBalance)],
    ["Current Fee", fmt(receipt.currentFee)],
    ["Discount", "− " + fmt(receipt.discount)],
    ["Paid", fmt(receipt.paid)],
    ["Remaining", fmtBalance(receipt.remaining)],
    ["Payment Method", receipt.method],
    ["Date", receipt.date],
    ["Received By", receipt.receivedBy],
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          #receipt-no-print { display: none; }
        }
      `}</style>

      <div id="receipt-print-area">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sage text-lg font-semibold">✓ Payment Successful</div>
        </div>
        <p className="text-xs text-slate-400 mb-4">Modern Science Academy — Fee Receipt</p>

        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="font-medium text-ink text-right">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div id="receipt-no-print" className="flex gap-2 mt-5">
        <button
          onClick={() => window.print()}
          className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Print Receipt
        </button>
        <a
          href={`/api/receipts/${receipt.paymentId}`}
          className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Download PDF
        </a>
        <button
          onClick={onClose}
          className="text-sm px-4 py-2 rounded-lg bg-royal text-white ml-auto"
        >
          Record Another Payment
        </button>
      </div>
    </div>
  );
}
