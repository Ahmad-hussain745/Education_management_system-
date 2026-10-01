import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";

export default async function SettingsRolesPage() {
  await requireRole(["Super Admin"]);
  const supabase = await createClient();
  const { data: roles } = await supabase.from("roles").select("name, permissions").order("name");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Settings — Roles</h1>
      <p className="text-sm text-slate-500 mt-1">
        The five fixed roles every RLS policy in this app checks against — Super Admin, Principal,
        Accountant, Cashier, Teacher. Roles themselves aren't user-editable: they're seeded once in the
        database migration, since every permission check throughout the app (is_admin(), is_finance_staff(),
        current_teacher_id(), and so on) is written against these exact names.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Permissions</th>
            </tr>
          </thead>
          <tbody>
            {(roles || []).map((r, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{r.name}</td>
                <td className="px-4 py-3 text-slate-500 text-xs font-mono">{JSON.stringify(r.permissions)}</td>
              </tr>
            ))}
            {(!roles || roles.length === 0) && (
              <tr><td colSpan={2} className="px-4 py-10 text-center text-slate-400">No roles seeded yet — run the seed section at the bottom of 0001_init.sql.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
