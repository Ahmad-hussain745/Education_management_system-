import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import NewUserForm from "./NewUserForm";
import UserRow from "./UserRow";

export default async function SettingsUsersPage() {
  await requireRole(["Super Admin"]);
  const supabase = await createClient();

  const { data: { user: authUser } } = await supabase.auth.getUser();
  const { data: me } = authUser
    ? await supabase.from("users").select("id").eq("auth_user_id", authUser.id).maybeSingle()
    : { data: null };

  const [{ data: rawUsers }, { data: roles }, { data: teachers }] = await Promise.all([
    supabase.from("users").select("id, name, email, status, role_id, role:roles(name)").order("name"),
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("teachers").select("id, name, user_id"),
  ]);

  // A user's "Teacher" column, if their login is linked to one (reverse of
  // teachers.user_id → users.id) — shown for context, not editable here.
  const teacherByUserId = new Map((teachers || []).filter((t) => t.user_id).map((t) => [t.user_id, t.name]));
  const allUsers = (rawUsers || []).map((u) => ({ ...u, teacher_name: teacherByUserId.get(u.id) }));

  // Requests from /register land here with role_id=null — surface them
  // first rather than let them sit alphabetically mixed in with everyone
  // else, since they need action (pick a role, then activate) and
  // deliberately-deactivated staff don't.
  const users = [...allUsers].sort((a, b) => (a.role_id ? 1 : 0) - (b.role_id ? 1 : 0));
  const pendingCount = allUsers.filter((u) => !u.role_id).length;

  // Only teachers without an existing login can be linked to a brand new one.
  const unlinkedTeachers = (teachers || []).filter((t) => !t.user_id);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Settings — Users</h1>
      <p className="text-sm text-slate-500 mt-1">
        Super Admin → Create User → Supabase Auth → public.users → Role → optional Teacher Link, in one
        step. Only a Super Admin can create logins or change another user's role/status. Requests
        submitted via the public /register page land below with no role yet — pick one, then Activate.
      </p>
      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mt-4">
          {pendingCount} account request{pendingCount === 1 ? "" : "s"} awaiting a role.
        </div>
      )}

      <div className="mt-6">
        <NewUserForm roles={roles} unlinkedTeachers={unlinkedTeachers} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Teacher</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => <UserRow key={u.id} user={u} roles={roles} isSelf={u.id === me?.id} />)}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
