import Link from "next/link";
import { getRoleContext } from "@/lib/auth/roles";

// Each tile only appears if that report's own page would actually admit
// this role (see each report's requireRole call) — mirrors the same
// role lists rather than a second, easily-drifting copy of them.
function buildReports(rc) {
  const r = rc || {};
  const canViewFees = r.isAdmin || r.isPrincipal || r.isAccountant || r.isCashier;
  const canViewFinance = r.isAdmin || r.isPrincipal || r.isAccountant;
  const canViewSalary = r.isAdmin || r.isPrincipal || r.isAccountant || r.isTeacher;
  const canViewSyllabus = r.isAdmin || r.isPrincipal || r.isAccountant || r.isTeacher;

  return [
    { href: "/reports/fee-collection", label: "Fee Collection", blurb: "Every bill for a month, by class and section.", visible: canViewFees },
    { href: "/reports/pending-fees", label: "Fee Arrears", blurb: "Outstanding balances by student — status, months owed, minimum-balance filter.", visible: canViewFees },
    { href: "/reports/student-ledger", label: "Student Ledger", blurb: "One student's full billing + payment history.", visible: canViewFees },
    { href: "/reports/teacher-salary", label: "Teacher Salary", blurb: r.isTeacher ? "Your salary by month." : "Every teacher's calculated salary by month.", visible: canViewSalary },
    { href: "/reports/attendance", label: "Attendance", blurb: "Present/Absent/Late/Leave, students and teachers.", visible: canViewFinance },
    { href: "/reports/finance", label: "Finance", blurb: "Income, outflow, and the full transaction ledger.", visible: canViewFinance },
    { href: "/reports/management", label: "Management Report", blurb: "Month-over-month comparison, trend, and a forward projection.", visible: canViewFinance },
    { href: "/reports/syllabus", label: "Syllabus", blurb: "Chapter progress by class and section.", visible: canViewSyllabus },
  ].filter((r) => r.visible);
}

export default async function ReportsPage() {
  const rc = await getRoleContext();
  const reports = buildReports(rc);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Reports</h1>
      <p className="text-sm text-slate-500 mt-1">
        Filter by date, month, class, section, teacher, or student — then Print/Save as PDF or Export CSV
        from any report.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        {reports.map((r) => (
          <Link key={r.href} href={r.href} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-royal transition">
            <div className="font-medium text-ink">{r.label}</div>
            <div className="text-sm text-slate-500 mt-1">{r.blurb}</div>
          </Link>
        ))}
        {reports.length === 0 && (
          <div className="text-slate-400 text-sm">No reports available for your role.</div>
        )}
      </div>
    </div>
  );
}
