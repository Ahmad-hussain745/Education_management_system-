import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import AnimatedValue from "@/components/AnimatedValue";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function FeeCollectionReportPage(props) {
  const searchParams = await props.searchParams;
  // Same table as Fee Records/Pending — can_view_fees() (Super Admin,
  // Principal, Accountant, Cashier). Teacher has no read policy on it.
  await requireRole(["Super Admin", "Principal", "Accountant", "Cashier"]);
  const supabase = await createClient();

  const month = searchParams?.month || currentMonthStr();
  const classId = searchParams?.class_id || "";
  const sectionId = searchParams?.section_id || "";

  const { data: classes } = await supabase.from("classes").select("id, name").order("sort_order");
  const { data: sections } = await supabase.from("sections").select("id, name, class_id").order("name");

  let query = supabase
    .from("fee_records")
    .select("id, monthly_fee, previous_balance, discount, total_payable, paid_total, status, student:students(name, class_id, section_id, class:classes(name), section:sections(name))")
    .eq("month", month);
  const { data: rawRows } = await query;

  const rows = (rawRows || []).filter((r) =>
    (!classId || r.student?.class_id === classId) && (!sectionId || r.student?.section_id === sectionId)
  );

  const totals = rows.reduce((a, r) => ({
    payable: a.payable + Number(r.total_payable),
    paid: a.paid + Number(r.paid_total),
  }), { payable: 0, paid: 0 });

  const csvRows = rows.map((r) => ({
    student: r.student?.name, class: r.student?.class?.name, section: r.student?.section?.name || "",
    monthly_fee: r.monthly_fee, previous_balance: r.previous_balance, discount: r.discount,
    total_payable: r.total_payable, paid_total: r.paid_total, status: r.status,
  }));
  const csvColumns = [
    { key: "student", label: "Student" }, { key: "class", label: "Class" }, { key: "section", label: "Section" },
    { key: "monthly_fee", label: "Monthly Fee" }, { key: "previous_balance", label: "Previous Balance" },
    { key: "discount", label: "Discount" }, { key: "total_payable", label: "Total Payable" },
    { key: "paid_total", label: "Paid" }, { key: "status", label: "Status" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Fee Collection Report</h1>
          <p className="text-sm text-slate-500 mt-1">Every bill generated for the selected month, straight from fee_records.</p>
        </div>
        <ReportToolbar rows={csvRows} columns={csvColumns} filename={`fee-collection-${month.slice(0, 7)}`} />
      </div>

      <ReportFilterBar
        fields={["month", "class", "section"]}
        values={{ month, class_id: classId, section_id: sectionId }}
        classes={classes}
        sections={sections}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Payable</div>
          <div className="text-lg font-semibold font-mono"><AnimatedValue value={fmt(totals.payable)} /></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Total Collected</div>
          <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={fmt(totals.paid)} /></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-left px-4 py-3">Section</th>
              <th className="text-right px-4 py-3">Total Payable</th>
              <th className="text-right px-4 py-3">Paid</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-ink">{r.student?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.student?.class?.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.student?.section?.name || "—"}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.total_payable)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_total)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "paid" ? "bg-green-50 text-sage" : r.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-brick"}`}>{r.status}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No bills for this month/filter yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
