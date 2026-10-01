import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { isMissingDbObjectError } from "@/lib/errors";
import ReportFilterBar from "@/components/reports/ReportFilterBar";
import ReportToolbar from "@/components/reports/ReportToolbar";
import Pagination from "@/components/Pagination";
import AnimatedValue from "@/components/AnimatedValue";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
function fmtMonth(m) {
  // Force UTC so the calendar date printed always matches the stored
  // "1st of the month" value, regardless of the server's own timezone.
  return new Date(m).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Status classification (oldest unpaid bill's age → Current / Partial /
// Overdue / Long Overdue) now lives in fee_arrears_filtered()
// (0029_scalable_listings.sql) — this is just display metadata keyed off
// the same status_key the SQL function returns.
const STATUS_META = {
  current: { label: "Current", badge: "bg-soft-blue text-royal" },
  partial: { label: "Partial", badge: "bg-gold-tint text-gold" },
  overdue: { label: "Overdue", badge: "bg-brick-tint text-brick" },
  long_overdue: { label: "Long Overdue", badge: "bg-brick text-white" },
};
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }));
const PAGE_SIZE = 20;

export default async function PendingFeesReportPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal", "Accountant", "Cashier"]);
  const supabase = await createClient();

  const classId = searchParams?.class_id || "";
  const sectionId = searchParams?.section_id || "";
  const studentId = searchParams?.student_id || "";
  const monthFilter = searchParams?.month || "";
  const statusFilter = searchParams?.status || "";
  const minBalance = Number(searchParams?.min_balance) || 0;
  const page = Math.max(1, Number(searchParams?.page) || 1);

  const rpcArgs = {
    p_class_id: classId || null,
    p_section_id: sectionId || null,
    p_student_id: studentId || null,
    p_month: monthFilter || null,
    p_status: statusFilter || null,
    p_min_balance: minBalance,
  };

  const [{ data: classes }, { data: sections }, { data: summaryRows, error: summaryError }, { data: accounts, error: accountsError }, { data: selectedStudent }] = await Promise.all([
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id").order("name"),
    // Aggregated over the FULL filtered set, independent of pagination —
    // the summary cards below always describe every matching account, not
    // just the ~20 currently on screen.
    supabase.rpc("fee_arrears_summary", rpcArgs),
    // Paginated: one row per student, with the DB-computed status/aging —
    // never a raw fee_records fetch grouped in JS anymore.
    supabase.rpc("fee_arrears_accounts", { ...rpcArgs, p_page: page, p_page_size: PAGE_SIZE }),
    studentId ? supabase.from("students").select("name").eq("id", studentId).maybeSingle() : { data: null },
  ]);
  const rpcError = summaryError || accountsError;

  const summary = summaryRows?.[0] || { total_outstanding: 0, students_with_arrears: 0, one_month: 0, two_months: 0, three_plus_months: 0 };
  const totalCount = accounts?.[0]?.total_count ?? 0;

  // Full unpaid-month breakdown for just this page's students — bounded to
  // at most PAGE_SIZE student_ids, never the whole arrears population, the
  // same "detail only for what's on screen" shape as the Students list
  // resolving monthly_fee for its one page of rows.
  const studentIds = (accounts || []).map((a) => a.student_id);
  const { data: recordRows } = studentIds.length
    ? await supabase
        .from("fee_records")
        .select("id, student_id, month, total_payable, paid_total, status")
        .in("student_id", studentIds)
        .neq("status", "paid")
        .order("month", { ascending: true })
    : { data: [] };
  const recordsByStudent = new Map();
  for (const r of recordRows || []) {
    if (!recordsByStudent.has(r.student_id)) recordsByStudent.set(r.student_id, []);
    recordsByStudent.get(r.student_id).push(r);
  }

  // Export reflects the current page/filter, same as every other list on
  // this pass — an unbounded "export everything" button is exactly the
  // pattern this migration is removing.
  const csvRows = (accounts || []).flatMap((a) =>
    (recordsByStudent.get(a.student_id) || []).map((r) => ({
      student: a.student_name,
      class: a.class_name,
      section: a.section_name || "",
      month: r.month?.slice(0, 7),
      total_payable: Number(r.total_payable),
      paid: Number(r.paid_total),
      remaining: Number(r.total_payable) - Number(r.paid_total),
      line_status: r.status,
      arrears_status: STATUS_META[a.status_key]?.label || a.status_key,
      months_overdue: a.months_overdue,
      student_total_arrears: Number(a.total_arrears),
      guardian_phone: a.guardian_phone || "",
    }))
  );
  const csvColumns = [
    { key: "student", label: "Student" }, { key: "class", label: "Class" }, { key: "section", label: "Section" },
    { key: "month", label: "Month" }, { key: "total_payable", label: "Total Payable" }, { key: "paid", label: "Paid" },
    { key: "remaining", label: "Remaining" }, { key: "line_status", label: "Line Status" },
    { key: "arrears_status", label: "Arrears Status" }, { key: "months_overdue", label: "Months Overdue" },
    { key: "student_total_arrears", label: "Student Total Arrears" }, { key: "guardian_phone", label: "Guardian Phone" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Fee Arrears</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every student with an outstanding balance, grouped into one account per student with the full unpaid-month breakdown.
          </p>
        </div>
        <ReportToolbar rows={csvRows} columns={csvColumns} filename="fee-arrears-page" />
      </div>

      <ReportFilterBar
        fields={["month", "class", "section", "student", "status", "minBalance"]}
        values={{
          class_id: classId, section_id: sectionId, student_id: studentId, student_name: selectedStudent?.name || "",
          month: monthFilter, status: statusFilter, min_balance: searchParams?.min_balance || "",
        }}
        classes={classes}
        sections={sections}
        statusOptions={STATUS_OPTIONS}
      />

      {rpcError && (
        <div className="bg-brick-tint border border-brick/30 text-brick text-sm rounded-lg px-4 py-3 mb-6">
          <p className="font-medium">Couldn't load fee arrears.</p>
          <p className="mt-1">
            {rpcError.message}
            {isMissingDbObjectError(rpcError.message) && " — a required database function is missing from this Supabase project (or its schema cache hasn't refreshed yet). Run every file in supabase/migrations/ against this project, in order (see README.md → Setup), then reload the schema cache from Settings → API in the Supabase dashboard if it still fails."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Total Outstanding</div>
          <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={fmt(summary.total_outstanding)} /></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">Students With Arrears</div>
          <div className="text-lg font-semibold font-mono text-ink"><AnimatedValue value={summary.students_with_arrears} /></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">1 Month Pending</div>
          <div className="text-lg font-semibold font-mono text-ink"><AnimatedValue value={summary.one_month} /></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">2 Months Pending</div>
          <div className="text-lg font-semibold font-mono text-gold"><AnimatedValue value={summary.two_months} /></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">3+ Months Pending</div>
          <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={summary.three_plus_months} /></div>
        </div>
      </div>

      <div className="space-y-3">
        {(accounts || []).map((a) => {
          const meta = STATUS_META[a.status_key] || { label: a.status_key, badge: "bg-slate-100 text-slate-600" };
          const records = recordsByStudent.get(a.student_id) || [];
          return (
            <details key={a.student_id} open className="bg-white rounded-xl border border-slate-200 overflow-hidden group">
              <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none list-none flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-ink">{a.student_name}</span>
                  <span className="text-sm text-slate-500">
                    {a.class_name}
                    {a.section_name ? ` — ${a.section_name}` : ""}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
                  <span className="text-xs text-slate-400">
                    {a.months_count} month{a.months_count > 1 ? "s" : ""} outstanding
                  </span>
                  {a.guardian_phone && (
                    <span className="text-xs text-slate-400">Guardian: {a.guardian_phone}</span>
                  )}
                </div>
                <span className="font-mono font-semibold text-brick whitespace-nowrap">{fmt(a.total_arrears)}</span>
              </summary>
              <div className="border-t border-slate-100">
                <table className="w-full text-sm">
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 first:border-t-0">
                        <td className="px-4 py-2 text-slate-600 w-1/3">{fmtMonth(r.month)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(Number(r.total_payable) - Number(r.paid_total))}</td>
                        <td className="px-4 py-2 text-right w-32">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "partial" ? "bg-gold-tint text-gold" : "bg-brick-tint text-brick"}`}>
                            {r.status === "partial" ? "Partial" : "Unpaid"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td className="px-4 py-2 font-medium text-ink">Total Arrears</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-brick">{fmt(a.total_arrears)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          );
        })}
        {(!accounts || accounts.length === 0) && (
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-slate-400 text-sm">
            {rpcError ? "Couldn't load fee arrears — see the message above." : "Nothing outstanding for this filter."}
          </div>
        )}
      </div>

      <Pagination searchParams={searchParams} page={page} pageSize={PAGE_SIZE} totalCount={totalCount} itemLabel="students with arrears" />
    </div>
  );
}
