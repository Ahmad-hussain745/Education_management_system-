import Link from "next/link";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmt, fmtDate } from "@/lib/parent-portal/format";

// Child Profile + a quick-stat overview, with every other section
// (Attendance, Fees, Payments, Exams, Syllabus, Homework, Timetable,
// Notices, Announcements, Support) one tap away via ParentShell's tab
// bar. Every query below relies on RLS (0030_parent_portal.sql's
// is_parent_of() policies, plus the get_child_* functions added in
// 20260926010000) as the actual boundary — selectedChild only decides
// which of the parent's OWN children's data to show; a value in the URL
// can never widen that.
export default async function ParentPortalPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null; // ParentShell already renders the "no child linked" message

  const child = resolveSelectedChild(searchParams, kids);
  const supabase = await createClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [profileRes, feeRes, attendanceRes, examRes, homeworkRes] = await Promise.all([
    supabase.from("students")
      .select("guardian_name, guardian_phone, guardian_email, address, admission_date, status")
      .eq("id", child.id).maybeSingle(),
    supabase.from("fee_records").select("total_payable, paid_total, status").eq("student_id", child.id),
    supabase.from("student_attendance").select("status").eq("student_id", child.id).gte("date", thirtyDaysAgo),
    supabase.from("exam_results").select("percentage, exam:exams(name)").eq("student_id", child.id).eq("status", "published")
      .order("published_at", { ascending: false }).limit(1),
    supabase.rpc("get_child_homework", { p_student_id: child.id, p_limit: 5 }),
  ]);

  const profile = profileRes.data;
  const outstanding = (feeRes.data || []).filter((r) => r.status !== "paid").reduce((s, r) => s + (Number(r.total_payable) - Number(r.paid_total)), 0);
  const attendance = attendanceRes.data || [];
  const presentPct = attendance.length > 0 ? Math.round((attendance.filter((a) => a.status === "present" || a.status === "late").length / attendance.length) * 100) : null;
  const latestExam = examRes.data?.[0];
  const homeworkDue = (homeworkRes.data || []).filter((h) => !h.due_date || h.due_date >= new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-6">
      {/* Child profile */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink">{child.name}</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {child.student_code} · {child.class?.name}{child.section?.name ? ` — ${child.section.name}` : ""}
            </p>
          </div>
          {profile?.status && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${profile.status === "active" ? "bg-sage-tint text-sage" : "bg-slate-100 text-slate-500"}`}>
              {profile.status}
            </span>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 pt-4 border-t border-slate-100 text-sm">
          <div><span className="text-slate-400">Guardian:</span> <span className="text-ink">{profile?.guardian_name || "—"}</span></div>
          <div><span className="text-slate-400">Admitted:</span> <span className="text-ink">{fmtDate(profile?.admission_date)}</span></div>
          <div><span className="text-slate-400">Phone:</span> <span className="text-ink">{profile?.guardian_phone || "—"}</span></div>
          <div><span className="text-slate-400">Email:</span> <span className="text-ink">{profile?.guardian_email || "—"}</span></div>
          {profile?.address && <div className="sm:col-span-2"><span className="text-slate-400">Address:</span> <span className="text-ink">{profile.address}</span></div>}
        </div>
      </section>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/portal/fees?child=${child.id}`} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300">
          <div className="text-xs text-slate-400">Fee Balance</div>
          <div className={`text-xl font-bold font-mono mt-1 ${outstanding > 0 ? "text-brick" : "text-sage"}`}>{fmt(outstanding)}</div>
        </Link>
        <Link href={`/portal/attendance?child=${child.id}`} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300">
          <div className="text-xs text-slate-400">Attendance — 30 days</div>
          <div className="text-xl font-bold font-mono mt-1 text-ink">{presentPct === null ? "—" : `${presentPct}%`}</div>
        </Link>
        <Link href={`/portal/exams?child=${child.id}`} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300">
          <div className="text-xs text-slate-400">Latest Exam</div>
          <div className="text-xl font-bold font-mono mt-1 text-ink">{latestExam ? `${Number(latestExam.percentage).toFixed(1)}%` : "—"}</div>
          {latestExam && <div className="text-xs text-slate-400 mt-0.5">{latestExam.exam?.name}</div>}
        </Link>
        <Link href={`/portal/homework?child=${child.id}`} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300">
          <div className="text-xs text-slate-400">Homework</div>
          <div className="text-xl font-bold font-mono mt-1 text-ink">{homeworkDue.length}</div>
          <div className="text-xs text-slate-400 mt-0.5">upcoming / recent</div>
        </Link>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Payment history, report cards, syllabus progress, timetable, notices, announcements and support
        requests are all in the tabs above.
      </p>
    </div>
  );
}
