import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import NewEmployeeForm from "./NewEmployeeForm";

export default async function NewEmployeePage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  // Only teachers/users not already linked to an employee record — a
  // teacher or login that's already an employee elsewhere shouldn't be
  // offered again (employees.teacher_id/user_id are each unique).
  const [{ data: linkedTeacherIds }, { data: linkedUserIds }, { data: teachers }, { data: users }] = await Promise.all([
    supabase.from("employees").select("teacher_id").not("teacher_id", "is", null),
    supabase.from("employees").select("user_id").not("user_id", "is", null),
    supabase.from("teachers").select("id, name").eq("status", "active").order("name"),
    supabase.from("users").select("id, name, role:roles(name)").eq("status", "active").order("name"),
  ]);

  const takenTeacherIds = new Set((linkedTeacherIds || []).map((r) => r.teacher_id));
  const takenUserIds = new Set((linkedUserIds || []).map((r) => r.user_id));
  const availableTeachers = (teachers || []).filter((t) => !takenTeacherIds.has(t.id));
  const availableUsers = (users || []).filter((u) => !takenUserIds.has(u.id) && u.role?.name !== "Parent");

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-ink mb-1">Add Employee</h1>
      <p className="text-sm text-slate-500 mb-6">
        Link to an existing teacher or portal login if this employee already has one — otherwise this is
        just a standalone HR record (a new hire without portal access yet, for example).
      </p>
      <NewEmployeeForm teachers={availableTeachers} users={availableUsers} />
    </div>
  );
}
