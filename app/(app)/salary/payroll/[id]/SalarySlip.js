"use client";

import Link from "next/link";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function monthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function SalarySlip({ record, items }) {
  const remaining = Math.max(0, Number(record.gross_salary) - Number(record.paid_total));
  const shareItems = items.filter((it) => it.item_type === "percentage_share");
  const allowanceItems = items.filter((it) => it.item_type === "allowance");
  const deductionItems = items.filter((it) => it.item_type === "deduction");
  const adjustmentItems = items.filter((it) => it.item_type === "adjustment");

  const headerRows = [
    ["Teacher", record.teacherName],
    ["Month", monthLabel(record.month)],
    ["Base Salary", fmt(record.base_salary)],
    ["Percentage Share", fmt(record.percentage_total)],
    ["Allowances", fmt(record.allowances_total)],
    ["Deductions", "− " + fmt(record.deductions_total)],
    ["Adjustments", fmt(record.adjustments_total)],
    ["Gross Salary", fmt(record.gross_salary)],
    ["Paid", fmt(record.paid_total)],
    ["Remaining", fmt(remaining)],
    ["Status", record.status + (record.locked ? " · locked" : "")],
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #slip-print-area, #slip-print-area * { visibility: visible; }
          #slip-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          #slip-no-print { display: none; }
        }
      `}</style>

      <div id="slip-no-print" className="mb-4">
        <Link href="/salary/payroll" className="text-sm text-slate-500 hover:text-ink">← Back to Payroll</Link>
      </div>

      <div id="slip-print-area">
        <div className="text-lg font-semibold text-ink">{monthLabel(record.month)} Salary</div>
        <p className="text-xs text-slate-400 mb-4">Modern Science Academy — Salary Slip</p>

        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-5">
          {headerRows.map(([label, value]) => (
            <div key={label} className="flex justify-between px-4 py-2 text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="font-medium text-ink text-right">{value}</span>
            </div>
          ))}
        </div>

        {shareItems.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Class-wise Percentage Share</div>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mb-5">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Class</th>
                  <th className="text-right px-3 py-2">Students</th>
                  <th className="text-right px-3 py-2">Collection</th>
                  <th className="text-right px-3 py-2">Percentage</th>
                  <th className="text-right px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shareItems.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{it.class?.name}{it.section?.name ? ` (${it.section.name})` : ""}</td>
                    <td className="px-3 py-2 text-right font-mono">{it.students_count ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(it.collected_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{it.percentage}%</td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {allowanceItems.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Allowances</div>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mb-5">
              <tbody>
                {allowanceItems.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2 text-slate-600">{it.note || "Allowance"}</td>
                    <td className="px-3 py-2 text-right font-mono text-sage">+ {fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {deductionItems.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Deductions</div>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mb-5">
              <tbody>
                {deductionItems.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2 text-slate-600">{it.note || "Deduction"}</td>
                    <td className="px-3 py-2 text-right font-mono text-brick">− {fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {adjustmentItems.length > 0 && (
          <>
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Adjustments</div>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <tbody>
                {adjustmentItems.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-2 text-slate-600">{it.note || "Adjustment"}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div id="slip-no-print" className="flex gap-2 mt-6">
        <button
          onClick={() => window.print()}
          className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Print
        </button>
        <a
          href={`/api/salary-slips/${record.id}`}
          className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          PDF
        </a>
      </div>
    </div>
  );
}
