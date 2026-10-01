import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import StudentDetailClient from "./StudentDetailClient";
import FinancialStatement from "./FinancialStatement";
import ParentAccess from "./ParentAccess";
import AnimatedValue from "@/components/AnimatedValue";

export default async function StudentDetailPage(props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createClient();
  const studentId = params.id;

  // Same booleans, same source as the sidebar/reports (lib/auth/roles.js) —
  // one request-memoized auth round trip instead of this page running its
  // own separate users/roles query, and it also gives us canViewFees so the
  // Financial Statement section can be skipped entirely for a Teacher, who
  // has no read policy on fee_records/fee_payments at all (RLS would just
  // return nothing for them).
  const rc = await getRoleContext();
  const canWrite = !!(rc?.isAdmin || rc?.isAccountant);
  const canViewFees = !!rc?.canViewFees;

  const [{ data: student }, { data: classes }, { data: sections }, { data: feeRows }, { data: discountRows }, { data: attendanceRows }, { data: billRows }] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_code, name, guardian_name, guardian_phone, address, class_id, section_id, admission_date, status, institute_id, class:classes(name), section:sections(name)")
      .eq("id", studentId)
      .maybeSingle(),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id"),
    // Empty (not an error) for anyone who isn't finance staff — fee_structures
    // / fee_discounts are read-restricted; the view below handles that.
    supabase.from("fee_structures").select("monthly_fee, effective_from, active").eq("student_id", studentId).order("effective_from", { ascending: false }),
    supabase.from("fee_discounts").select("amount, reason, active, created_at").eq("student_id", studentId).order("created_at", { ascending: false }),
    // Same three columns, same aggregation shape as the Dashboard and the
    // Attendance Reports pages (present ÷ total × 100) — kept identical on
    // purpose so a student's own record can never disagree with those.
    supabase.from("student_attendance").select("status, date").eq("student_id", studentId).order("date", { ascending: false }).limit(500),
    // Every bill ever generated for this student, oldest first — the same
    // fee_records table Fee Records/Payment Entry/Pending Fees already read,
    // just scoped to one student. Skipped outright (rather than fetched and
    // then hidden) when the signed-in role has no read policy on it.
    canViewFees
      ? supabase.from("fee_records").select("id, month, monthly_fee, previous_balance, discount, total_payable, paid_total, status").eq("student_id", studentId).order("month", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  if (!student) notFound();

  let parentLinks = [];
  let unlinkedParents = [];
  if (rc?.isAdmin) {
    const [{ data: links }, { data: allParents }] = await Promise.all([
      supabase.from("parent_students").select("id, parent_user_id, parent:users(name, email)").eq("student_id", studentId),
      supabase.from("users").select("id, name, email, role:roles(name)").eq("status", "active"),
    ]);
    parentLinks = links || [];
    const linkedIds = new Set(parentLinks.map((l) => l.parent_user_id));
    unlinkedParents = (allParents || []).filter((u) => u.role?.name === "Parent" && !linkedIds.has(u.id));
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeFeeOverride = (feeRows || []).find((r) => r.active && r.effective_from <= today);
  const activeDiscount = (discountRows || []).find((r) => r.active);
  const totalActiveDiscount = (discountRows || []).filter((r) => r.active).reduce((a, r) => a + Number(r.amount || 0), 0);

  const thisMonth = today.slice(0, 7);
  const monthRows = (attendanceRows || []).filter((r) => r.date.slice(0, 7) === thisMonth);
  const attendance = {
    present: monthRows.filter((r) => r.status === "present").length,
    absent: monthRows.filter((r) => r.status === "absent").length,
    late: monthRows.filter((r) => r.status === "late").length,
    leave: monthRows.filter((r) => r.status === "leave").length,
    total: monthRows.length,
  };
  const attendancePct = attendance.total > 0 ? ((attendance.present / attendance.total) * 100).toFixed(1) : null;

  // "Current" bill for the Financial Summary block = this calendar month's
  // fee_records row if it's been generated yet, otherwise the most recent
  // one that has (Generate Monthly Fees can lag a few days into a new
  // month) — never an aggregate, since total_payable/paid_total on a single
  // row already are the running Previous Balance + Fee − Discount figures.
  const feeHistory = billRows || [];
  const currentMonthStr = `${thisMonth}-01`;
  const currentBill = feeHistory.find((r) => r.month === currentMonthStr) || feeHistory[feeHistory.length - 1] || null;

  return (
    <div className="max-w-3xl">
      <Link href="/students" className="text-sm text-slate-500 hover:text-ink">← Back to Students</Link>

      <StudentDetailClient
        student={student}
        instituteId={student.institute_id}
        classes={classes || []}
        sections={sections || []}
        feeHistory={feeRows || []}
        discountHistory={discountRows || []}
        currentFeeOverride={activeFeeOverride?.monthly_fee ?? null}
        currentDiscount={totalActiveDiscount}
        currentDiscountReason={activeDiscount?.reason || ""}
        canWrite={canWrite}
        startInEdit={canWrite && searchParams?.edit === "1"}
      />

      {canViewFees && (
        <>
          <FinancialStatement student={student} currentBill={currentBill} feeHistory={feeHistory} />

          {rc?.isAdmin && (
            <ParentAccess studentId={studentId} links={parentLinks} unlinkedParents={unlinkedParents} isAdmin={rc.isAdmin} />
          )}
        </>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mt-4">
        <div className="text-xs text-slate-500 mb-3">Attendance — {thisMonth}</div>
        {attendancePct === null ? (
          <p className="text-sm text-slate-400">No attendance recorded for this student this month.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="text-center">
              <div className="text-lg font-semibold font-mono text-sage"><AnimatedValue value={attendance.present} /></div>
              <div className="text-xs text-slate-500">Present</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold font-mono text-brick"><AnimatedValue value={attendance.absent} /></div>
              <div className="text-xs text-slate-500">Absent</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold font-mono text-gold"><AnimatedValue value={attendance.late} /></div>
              <div className="text-xs text-slate-500">Late</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold font-mono text-ink"><AnimatedValue value={attendance.leave} /></div>
              <div className="text-xs text-slate-500">Leave</div>
            </div>
            <div className="text-center">
              <div className={"text-lg font-semibold font-mono " + (Number(attendancePct) >= 75 ? "text-sage" : "text-brick")}><AnimatedValue value={`${attendancePct}%`} /></div>
              <div className="text-xs text-slate-500">Attendance</div>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">
          Present ÷ Total marked days × 100 — same formula as the Dashboard and Attendance Reports.
        </p>
      </div>
    </div>
  );
}
