import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import TeacherAttendanceRegister from "./TeacherAttendanceRegister";
import DateJumpInput from "./DateJumpInput";

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TeacherAttendancePage(props) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const date = searchParams?.date || new Date().toISOString().slice(0, 10);

  // Reuses the request-memoized lookup app/(app)/layout.js already ran for
  // the sidebar (see lib/auth/roles.js), instead of this page repeating its
  // own auth.getUser() + users query. The RLS policy on teacher_attendance
  // enforces the same restriction independently at the database layer, so
  // this remains a UX narrowing, not the real gate.
  const roleContext = await getRoleContext();
  const isTeacherOnly = roleContext?.isTeacher;

  let teachersQuery = supabase
    .from("teachers")
    .select("id, name, user_id, subject:subjects(name)")
    .eq("status", "active")
    .order("name");

  if (isTeacherOnly) {
    teachersQuery = teachersQuery.eq("user_id", roleContext.userId);
  }

  const { data: teachers } = await teachersQuery;

  const teacherIds = (teachers || []).map((t) => t.id);
  const { data: existing } = teacherIds.length
    ? await supabase
        .from("teacher_attendance")
        .select("teacher_id, status, check_in, check_out")
        .eq("date", date)
        .in("teacher_id", teacherIds)
    : { data: [] };

  const existingByTeacherId = Object.fromEntries((existing || []).map((r) => [r.teacher_id, r]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Teacher Attendance</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isTeacherOnly
              ? "Your own attendance for the day"
              : `${teachers?.length ?? 0} active teacher${teachers?.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link href={`?date=${shiftDate(date, -1)}`} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            ← Prev
          </Link>
          <DateJumpInput date={date} />
          <Link href={`?date=${new Date().toISOString().slice(0, 10)}`} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            Today
          </Link>
          <Link href={`?date=${shiftDate(date, 1)}`} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            Next →
          </Link>
        </div>
      </div>

      {isTeacherOnly && !teachers?.length && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
          Your login isn't linked to a teacher profile yet — ask a Super Admin to set this on your Teachers record
          before you can mark your own attendance.
        </div>
      )}

      <TeacherAttendanceRegister teachers={teachers || []} existingByTeacherId={existingByTeacherId} date={date} />
    </div>
  );
}
