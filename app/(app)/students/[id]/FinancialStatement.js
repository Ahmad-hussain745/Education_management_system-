"use client";

import { useState } from "react";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
// A negative balance means the student has credit (paid more than was
// due, e.g. an advance payment) — label it instead of showing "Rs. 0" or
// a confusing negative rupee figure.
function fmtBalance(n) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `Credit Rs. ${Math.abs(v).toLocaleString("en-US")}` : fmt(v);
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Renders the same "current bill" fields Payment Entry/Fee Records already
// show for one row, plus the full month-by-month history below it — a
// statement view, not a new source of numbers. Print/PDF/Excel all read
// from these same two props, so all three exports can never disagree with
// each other or with what's on screen.
export default function FinancialStatement({ student, currentBill, feeHistory }) {
  const summaryRows = currentBill
    ? [
        ["Current Fee", fmt(currentBill.monthly_fee)],
        ["Previous Balance", fmt(currentBill.previous_balance)],
        ["Discount", "− " + fmt(currentBill.discount)],
        ["Total Payable", fmt(currentBill.total_payable)],
        ["Paid", fmt(currentBill.paid_total)],
        ["Remaining", fmtBalance(Number(currentBill.total_payable) - Number(currentBill.paid_total))],
      ]
    : [];

  // xlsx is a genuinely large library (a few hundred KB) that only this one
  // button needs — every OTHER visit to a student's page (the vast
  // majority: viewing the statement, printing, downloading the PDF) never
  // touches it at all. A static top-level `import * as XLSX from "xlsx"`
  // meant every page load paid that cost regardless of whether Export
  // Excel was ever clicked. This dynamic import instead fetches it only at
  // the moment someone actually clicks the button — the first click on any
  // given page load is a little slower while it downloads, every load
  // before that is faster, and every subsequent click in the same session
  // is instant (the module stays cached once loaded).
  const [exporting, setExporting] = useState(false);
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const aoa = [
        [student.name],
        [student.student_code || ""],
        [`${student.class?.name || ""}${student.section?.name ? ` — ${student.section.name}` : ""}`],
        [],
        ["Financial Summary"],
        ...summaryRows,
        [],
        ["Fee History"],
        ["Month", "Payable", "Paid", "Balance"],
        ...feeHistory.map((r) => [
          monthLabel(r.month),
          Number(r.total_payable),
          Number(r.paid_total),
          Number(r.total_payable) - Number(r.paid_total),
        ]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Statement");
      const safeName = (student.student_code || student.name || "statement").replace(/\s+/g, "-");
      XLSX.writeFile(wb, `statement-${safeName}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 mt-4">
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #statement-print-area, #statement-print-area * { visibility: visible; }
          #statement-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          #statement-no-print { display: none; }
        }
      `}</style>

      <div id="statement-print-area">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-ink">{student.name}</h2>
          <p className="text-xs font-mono text-slate-400 mt-0.5">{student.student_code || "no ID assigned"}</p>
          <p className="text-sm text-slate-500 mt-0.5">
            {student.class?.name}
            {student.section?.name ? ` — ${student.section.name}` : ""}
          </p>
        </div>

        {!currentBill ? (
          <p className="text-sm text-slate-400">No fee bills generated yet for this student.</p>
        ) : (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Financial Summary</div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-6">
              {summaryRows.map(([label, value], i) => (
                <div
                  key={label}
                  className={`flex justify-between px-4 py-2 text-sm ${label === "Total Payable" || label === "Remaining" ? "font-semibold" : ""}`}
                >
                  <span className="text-slate-500">{label}</span>
                  <span className={`font-mono text-right ${label === "Remaining" ? (Number(currentBill.total_payable) - Number(currentBill.paid_total) > 0 ? "text-brick" : "text-sage") : "text-ink"}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Fee History</div>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Month</th>
                    <th className="text-right px-4 py-2">Payable</th>
                    <th className="text-right px-4 py-2">Paid</th>
                    <th className="text-right px-4 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {feeHistory.map((r) => {
                    const balance = Number(r.total_payable) - Number(r.paid_total);
                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-600">{monthLabel(r.month)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(r.total_payable)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(r.paid_total)}</td>
                        <td className={`px-4 py-2 text-right font-mono ${balance > 0 ? "text-brick" : "text-sage"}`}>{fmtBalance(balance)}</td>
                      </tr>
                    );
                  })}
                  {feeHistory.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No bills yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div id="statement-no-print" className="flex flex-wrap gap-2">
        <button onClick={() => window.print()} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
          Print Statement
        </button>
        <a href={`/api/student-statements/${student.id}`} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
          Download PDF
        </a>
        <button onClick={handleExportExcel} disabled={!currentBill || exporting} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
          {exporting ? "Preparing…" : "Export Excel"}
        </button>
      </div>
    </div>
  );
}
