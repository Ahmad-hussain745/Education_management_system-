"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { approveAndLock, recordSalaryPayment } from "./actions";
import { useOnline } from "@/lib/offline/useOnline";
import { ONLINE_REQUIRED_MESSAGE } from "@/lib/offline/online-required";
import OnlineRequiredGate from "@/components/OnlineRequiredGate";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default function PayrollRecordCard({ record, items, otherItems, canApprove, canPay }) {
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bank Transfer");
  const [locking, startLocking] = useTransition();
  const [paying, startPaying] = useTransition();
  const router = useRouter();
  const online = useOnline();

  const remaining = Math.max(0, Number(record.gross_salary) - Number(record.paid_total));

  const handleLock = () => {
    // Payroll approval is explicitly ONLINE REQUIRED — see
    // lib/offline/online-required.js. Checked before the confirm() dialog
    // even opens, not just before the RPC call.
    if (!online) {
      setError(ONLINE_REQUIRED_MESSAGE);
      return;
    }
    if (!confirm(`Approve & lock ${record.teacher_name}'s ${fmt(record.gross_salary)} payroll for this month? This can't be undone — the amounts are final once locked.`)) return;
    setError("");
    startLocking(async () => {
      const res = await approveAndLock(record.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handlePay = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("salary_record_id", record.id);
    formData.set("teacher_id", record.teacher_id);
    formData.set("month", record.month);
    formData.set("amount", amount);
    formData.set("method", method);
    startPaying(async () => {
      const res = await recordSalaryPayment(formData);
      if (res?.error) { setError(res.error); return; }
      setAmount("");
      router.refresh();
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-ink">{record.teacher_name}</div>
          <div className="text-xs text-slate-500">
            Base {fmt(record.base_salary)} + Percentage {fmt(record.percentage_total)} + Allowances {fmt(record.allowances_total)}
            {" − "}Deductions {fmt(record.deductions_total)} + Adjustments {fmt(record.adjustments_total)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono font-semibold">{fmt(record.gross_salary)}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${record.status === "paid" ? "bg-green-50 text-sage" : record.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
            {record.status}{record.locked ? " · locked" : ""}
          </span>
        </div>
      </div>

      {items?.length > 0 && (
        <table className="w-full text-xs mt-3 border-t border-slate-100 pt-2">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left py-1">Class</th>
              <th className="text-right py-1">Students</th>
              <th className="text-right py-1">Fee/Student</th>
              <th className="text-right py-1">Collected</th>
              <th className="text-right py-1">%</th>
              <th className="text-right py-1">Share</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-50">
                <td className="py-1">{it.class?.name}{it.section?.name ? ` (${it.section.name})` : ""}</td>
                <td className="py-1 text-right font-mono">{it.students_count ?? "—"}</td>
                <td className="py-1 text-right font-mono">{fmt(it.fee_per_student)}</td>
                <td className="py-1 text-right font-mono">{fmt(it.collected_amount)}</td>
                <td className="py-1 text-right font-mono">{it.percentage}%</td>
                <td className="py-1 text-right font-mono">{fmt(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {otherItems?.length > 0 && (
        <div className="text-xs mt-3 border-t border-slate-100 pt-2 space-y-1">
          {otherItems.map((it) => (
            <div key={it.id} className="flex justify-between">
              <span className="text-slate-500">{it.note || (it.item_type === "allowance" ? "Allowance" : "Deduction")}</span>
              <span className={`font-mono ${it.item_type === "deduction" ? "text-brick" : "text-sage"}`}>
                {it.item_type === "deduction" ? "− " : "+ "}{fmt(it.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        <Link href={`/salary/payroll/${record.id}`} className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
          Salary Slip
        </Link>
        {!record.locked && canApprove && (
          <OnlineRequiredGate>
            <button onClick={handleLock} disabled={locking} className="text-sm px-3 py-1.5 rounded-lg border border-royal text-royal disabled:opacity-60">
              {locking ? "Locking…" : "Approve & Lock"}
            </button>
          </OnlineRequiredGate>
        )}
        {remaining > 0 && canPay && (
          <form onSubmit={handlePay} className="flex items-center gap-2">
            <input
              type="number" min="0" step="0.01" placeholder={`Pay up to ${fmt(remaining)}`}
              value={amount} onChange={(e) => setAmount(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-40"
            />
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              {["Bank Transfer", "Cash", "Cheque", "Easypaisa", "JazzCash", "Card"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="submit" disabled={paying} className="text-sm px-3 py-1.5 rounded-lg bg-sage text-white disabled:opacity-60">
              {paying ? "Saving…" : "Pay"}
            </button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-brick mt-2">{error}</p>}
    </div>
  );
}
