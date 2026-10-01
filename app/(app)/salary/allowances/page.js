import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import RecurringItemForm from "./RecurringItemForm";
import ToggleRecurringItemButton from "./ToggleRecurringItemButton";

function fmt(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

export default async function SalaryAllowancesPage() {
  // Same tier as Salary Configuration — Principal can view, only finance
  // staff can write (enforced again below and, for real, by RLS).
  await requireRole(["Super Admin", "Accountant", "Principal"]);
  const rc = await getRoleContext();
  const canWrite = rc?.isFinanceStaff || false;
  const supabase = await createClient();

  const [{ data: items }, { data: teachers }] = await Promise.all([
    supabase
      .from("salary_recurring_items")
      .select("id, item_type, label, amount, active, teacher_id, teacher:teachers(name)")
      .order("created_at", { ascending: false }),
    supabase.from("teachers").select("id, name").eq("status", "active").order("name"),
  ]);

  const byTeacher = {};
  (items || []).forEach((it) => {
    const key = it.teacher_id;
    (byTeacher[key] ||= { name: it.teacher?.name || "—", items: [] }).items.push(it);
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Allowances &amp; Deductions</h1>
      <p className="text-sm text-slate-500 mt-1">
        Standing amounts added to or subtracted from a teacher's pay — a transport allowance, an ongoing
        advance recovery. Picked up automatically by every future payroll draft (Generate/Refresh, and the
        automatic monthly draft) until turned off; an already-locked month is never touched.
      </p>

      <div className="mt-6">
        {canWrite ? (
          <RecurringItemForm teachers={teachers} />
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
            You can view allowances and deductions, but only Super Admin or Accountant can change them.
          </div>
        )}
      </div>

      <div className="space-y-5">
        {Object.entries(byTeacher).map(([teacherId, group]) => (
          <div key={teacherId} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-ink mb-3">Teacher: {group.name}</div>
            <div className="space-y-2">
              {group.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="text-sm text-ink">
                    <span className={`text-xs px-1.5 py-0.5 rounded mr-2 ${it.item_type === "allowance" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {it.item_type === "allowance" ? "Allowance" : "Deduction"}
                    </span>
                    {it.label}
                    <span className="font-mono font-medium ml-2">{fmt(it.amount)}</span>
                    {!it.active && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">off</span>}
                  </div>
                  {canWrite && <ToggleRecurringItemButton id={it.id} active={it.active} />}
                </div>
              ))}
            </div>
          </div>
        ))}
        {(!items || items.length === 0) && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
            No allowances or deductions configured yet.
          </div>
        )}
      </div>
    </div>
  );
}
