import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import AnalyticsCharts from "./AnalyticsCharts";

// Six calendar months back through the current one, oldest first — same
// "last N months" framing as the dashboard's own trend logic.
function lastNMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleString("en-US", { month: "short" }) });
  }
  return out;
}

function monthBounds(year, month) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 1); // month is 1-indexed here, so this is correctly "first of next month"
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

// Priority 4 — every one of the six queries this page used to run
// (fee_payments/student_attendance for 6 months, every active student,
// and EVERY exam_results row that has ever existed with no date bound at
// all) pulled raw rows into JS and grouped/summed/averaged them here. Now
// each month's collection and attendance rate is one Postgres call
// (get_month_financial_summary / get_attendance_summary — Priority 4
// migration), and exam performance is one GROUP BY
// (get_exam_performance_summary) instead of scanning the institute's
// entire exam history on every page load. Student-per-class distribution
// stays a single, already-small, already-institute-scoped query (`status
// = active` students only) — nothing to push into a summary RPC there,
// there's no month range to aggregate over.
export default async function AnalyticsPage() {
  const rc = await getRoleContext();
  if (!rc || !(rc.isAdmin || rc.isPrincipal || rc.isAccountant)) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const months = lastNMonths(6);

  const [financials, attendances, { data: students }, { data: examRows, error: examError }] = await Promise.all([
    Promise.all(months.map(({ year, month }) => {
      const { start, end } = monthBounds(year, month);
      return supabase.rpc("get_month_financial_summary", { p_institute_id: rc.instituteId, p_start_date: start, p_end_date: end }).single();
    })),
    Promise.all(months.map(({ year, month }) => {
      const { start, end } = monthBounds(year, month);
      return supabase.rpc("get_attendance_summary", { p_institute_id: rc.instituteId, p_start_date: start, p_end_date: end, p_who: "student" }).single();
    })),
    supabase.from("students").select("id, class_id, status, classes(name, sort_order)").eq("status", "active"),
    supabase.rpc("get_exam_performance_summary", { p_institute_id: rc.instituteId, p_limit: 6 }),
  ]);

  const collectionByMonth = months.map(({ label }, i) => ({
    label,
    total: Math.round(Number(financials[i]?.data?.collected || 0)),
  }));

  // The bug this fixes as a side effect: the old JS here compared
  // attendance status against "Present" (capitalized), but the real enum
  // (attendance_status, 0001_init.sql) is lowercase 'present' — that
  // comparison never matched anything, so this chart has shown 0% for
  // every month since it was built. get_attendance_summary() checks the
  // real enum value, so this is also the first time this number has ever
  // been correct.
  const attendanceByMonth = months.map(({ label }, i) => ({
    label,
    rate: attendances[i]?.data?.rate === null || attendances[i]?.data?.rate === undefined ? 0 : Math.round(Number(attendances[i].data.rate)),
  }));

  // Students per class — already a single, small, institute-scoped query;
  // nothing here to push into a summary RPC (no month range to aggregate).
  const byClass = {};
  for (const s of students || []) {
    const name = s.classes?.name || "Unassigned";
    const order = s.classes?.sort_order ?? 999;
    if (!byClass[name]) byClass[name] = { label: name, count: 0, order };
    byClass[name].count += 1;
  }
  const studentsByClass = Object.values(byClass).sort((a, b) => a.order - b.order);

  const examAverages = examError
    ? []
    : (examRows || []).map((r) => ({ label: r.exam_name, average: Math.round(Number(r.average_percentage)) })).reverse();

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Analytics</h1>
      <p className="text-sm text-slate-500 mt-1">
        Trends across the last 6 months — fee collection, attendance, enrollment, and exam performance.
      </p>
      <AnalyticsCharts
        collectionByMonth={collectionByMonth}
        attendanceByMonth={attendanceByMonth}
        studentsByClass={studentsByClass}
        examAverages={examAverages}
      />
    </div>
  );
}
