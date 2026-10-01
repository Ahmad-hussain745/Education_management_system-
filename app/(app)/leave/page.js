import Link from "next/link";
import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import LeaveClient from "./LeaveClient";

export default async function LeavePage() {
  const rc = await getRoleContext();
  if (!rc) redirect("/login");
  if (rc.isParent) redirect("/dashboard?denied=1");

  const supabase = await createClient();
  const { data: ctxRows } = await supabase.rpc("get_my_leave_context");
  const me = ctxRows?.[0];

  if (!me) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-ink">Leave</h1>
        <p className="text-sm text-slate-500 mt-2">
          Your account isn't linked to an HR employee record yet, so leave can't be requested from here.
          Ask HR to add you (or link your teacher record) under HR → Employees.
        </p>
        {(rc.isAdmin || rc.isPrincipal) && (
          <Link href="/hr/leave" className="inline-block mt-3 text-sm text-royal hover:underline">Go to the HR leave queue →</Link>
        )}
      </div>
    );
  }

  const year = new Date().getFullYear();
  const [{ data: balances }, { data: types }, { data: requests }, { data: inbox }] = await Promise.all([
    supabase.rpc("get_leave_balances", { p_employee_id: me.employee_id, p_year: year }),
    supabase.from("leave_types").select("id, name, is_paid").order("name"),
    supabase.from("leave_requests")
      .select("id, date_from, date_to, days_count, days_paid, days_unpaid, reason, status, decision_note, payroll_note, leave_type:leave_types(name, is_paid)")
      .eq("employee_id", me.employee_id).order("date_from", { ascending: false }).limit(50),
    me.is_supervisor ? supabase.rpc("get_leave_inbox") : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Leave</h1>
          <p className="text-sm text-slate-500 mt-1">
            {me.supervisor_name ? `Requests go to ${me.supervisor_name} for approval.` : "You have no supervisor on record, so requests go to HR for approval."}
          </p>
        </div>
        {(rc.isAdmin || rc.isPrincipal) && (
          <Link href="/hr/leave" className="text-sm text-royal hover:underline">HR leave queue →</Link>
        )}
      </div>
      <LeaveClient me={me} balances={balances || []} types={types || []} requests={requests || []} inbox={inbox || []} year={year} />
    </div>
  );
}
