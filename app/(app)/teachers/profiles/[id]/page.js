import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CreateAccountForm from "./CreateAccountForm";

export default async function TeacherDetailPage(props) {
  const params = await props.params;
  const supabase = await createClient();
  const teacherId = params.id;

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("users").select("role:roles(name)").eq("auth_user_id", user.id).maybeSingle();
  const isSuperAdmin = me?.role?.name === "Super Admin";

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, name, phone, salary_mode, fixed_salary, status, subject:subjects(name), user:users(id, email, status)")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher) notFound();

  const { data: assignments } = await supabase
    .from("teacher_classes")
    .select("class:classes(name), section:sections(name), subject:subjects(name)")
    .eq("teacher_id", teacherId);

  return (
    <div className="max-w-3xl">
      <Link href="/teachers/profiles" className="text-sm text-royal hover:underline">← Teacher Profiles</Link>

      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{teacher.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{teacher.subject?.name || "No subject set"}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${teacher.status === "active" ? "bg-green-50 text-sage" : "bg-slate-100 text-slate-500"}`}>
          {teacher.status}
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-2">Profile</div>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd>{teacher.phone || "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Salary Mode</dt><dd className="capitalize">{teacher.salary_mode}</dd></div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{teacher.salary_mode === "hybrid" ? "Base Salary" : "Fixed Salary"}</dt>
              <dd className="font-mono">Rs. {Number(teacher.fixed_salary || 0).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-2">Classes Assigned</div>
          {assignments && assignments.length > 0 ? (
            <ul className="text-sm space-y-1">
              {assignments.map((a, i) => (
                <li key={i}>
                  {a.class?.name}{a.section?.name ? `-${a.section.name}` : ""} · {a.subject?.name || "—"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">
              None yet — <Link href="/teachers/classes" className="text-royal hover:underline">assign classes</Link>.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs text-slate-500 mb-3">Teacher Login</div>

        {teacher.user ? (
          <div className="text-sm">
            <p className="text-sage font-medium">✓ Linked to a login account</p>
            <dl className="mt-2 space-y-1">
              <div className="flex justify-between max-w-sm"><dt className="text-slate-500">Email</dt><dd>{teacher.user.email}</dd></div>
              <div className="flex justify-between max-w-sm"><dt className="text-slate-500">Account status</dt><dd>{teacher.user.status}</dd></div>
            </dl>
            <p className="text-xs text-slate-400 mt-3">
              This teacher can now sign in and see only their own attendance, classes, syllabus and salary —
              enforced by RLS in <code className="font-mono">0002_rls.sql</code>, not just this page.
            </p>
          </div>
        ) : isSuperAdmin ? (
          <>
            <p className="text-xs text-slate-500 mb-3">
              No login yet. Creating one links <code className="font-mono">users.auth_user_id → users.id → teachers.user_id</code>,
              which is what turns on this teacher's "own attendance / own classes / own syllabus / own salary" access.
            </p>
            <CreateAccountForm teacherId={teacher.id} />
          </>
        ) : (
          <p className="text-sm text-slate-400">No login yet — only a Super Admin can create one.</p>
        )}
      </div>
    </div>
  );
}
