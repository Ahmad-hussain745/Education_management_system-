import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import AnimatedValue from "@/components/AnimatedValue";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// Every bill (fee_records) and every payment (fee_payments) for one
// student, merged into a single running ledger — a statement, not a
// snapshot. Nothing here is a separate stored total; it's the same two
// tables Payment Entry and Fee Records already read, just laid out
// chronologically for one student instead of one month.
export default async function StudentLedgerReportPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant", "Cashier"]);
  const supabase = await createClient();

  const studentId = searchParams?.student_id || "";

  let entries = [];
  let student = null;
  let runningTotal = { billed: 0, paid: 0 };

  if (studentId) {
    const [{ data: s }, { data: records }, { data: payments }] = await Promise.all([
      supabase.from("students").select("name, guardian_name, guardian_phone, class:classes(name), section:sections(name)").eq("id", studentId).maybeSingle(),
      supabase.from("fee_records").select("id, month, total_payable, status").eq("student_id", studentId).order("month"),
      supabase.from("fee_payments").select("id, amount, method, paid_on, remarks").eq("student_id", studentId).order("paid_on"),
    ]);
    student = s;

    const billLines = (records || []).map((r) => ({
      date: r.month, type: "Bill", detail: `${r.month?.slice(0, 7)} bill (${r.status})`, billed: Number(r.total_payable), paid: 0,
    }));
    const paymentLines = (payments || []).map((p) => ({
      date: p.paid_on, type: "Payment", detail: `${p.method}${p.remarks ? ` — ${p.remarks}` : ""}`, billed: 0, paid: Number(p.amount),
    }));

    entries = [...billLines, ...paymentLines].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

    let running = 0;
    entries = entries.map((e) => {
      running += e.billed - e.paid;
      return { ...e, balance: running };
    });
    runningTotal = entries.reduce((a, e) => ({ billed: a.billed + e.billed, paid: a.paid + e.paid }), { billed: 0, paid: 0 });
  }

  const csvRows = entries.map((e) => ({ date: e.date, type: e.type, detail: e.detail, billed: e.billed || "", paid: e.paid || "", balance: e.balance }));
  const csvColumns = [
    { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "detail", label: "Detail" },
    { key: "billed", label: "Billed" }, { key: "paid", label: "Paid" }, { key: "balance", label: "Running Balance" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Student Ledger</h1>
          <p className="text-sm text-slate-500 mt-1">Full billing and payment history for one student, in order.</p>
        </div>
        {studentId && <ReportToolbar rows={csvRows} columns={csvColumns} filename={`ledger-${student?.name || studentId}`} />}
      </div>

      <ReportFilterBar fields={["student"]} values={{ student_id: studentId, student_name: student?.name || "" }} />

      {!studentId && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          Select a student above to see their full fee history.
        </div>
      )}

      {studentId && student && (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
            <div className="font-medium text-ink">{student.name}</div>
            <div className="text-sm text-slate-500">{student.class?.name}{student.section?.name ? ` — ${student.section.name}` : ""}{student.guardian_name ? ` · Guardian: ${student.guardian_name}` : ""}{student.guardian_phone ? ` (${student.guardian_phone})` : ""}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Total Billed</div>
              <div className="text-lg font-semibold font-mono"><AnimatedValue value={fmt(runningTotal.billed)} /></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Total Paid</div>
              <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={fmt(runningTotal.paid)} /></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Current Balance</div>
              <div className={`text-lg font-semibold font-mono ${runningTotal.billed - runningTotal.paid > 0 ? "text-brick" : "text-sage"}`}>
                <AnimatedValue value={fmt(runningTotal.billed - runningTotal.paid)} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Detail</th>
                  <th className="text-right px-4 py-3">Billed</th>
                  <th className="text-right px-4 py-3">Paid</th>
                  <th className="text-right px-4 py-3">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-600">{e.date}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${e.type === "Payment" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-600"}`}>{e.type}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{e.detail}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.billed ? fmt(e.billed) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{e.paid ? fmt(e.paid) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{fmt(e.balance)}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No billing history yet for this student.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
