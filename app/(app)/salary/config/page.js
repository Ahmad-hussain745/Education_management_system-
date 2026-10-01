import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import { getRoleContext } from "@/lib/auth/roles";
import SalaryRuleForm from "./SalaryRuleForm";
import { getSalaryRuleHistoryByRuleIds } from "./actions";

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtMonth(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default async function SalaryConfigPage() {
  // salary_rules write is "finance staff" only (Super Admin, Accountant) —
  // Principal can view (their own "view salary rules" RLS policy) but the
  // rule-creation form would fail on submit for them, so it's gated
  // separately from the page-level requireRole below.
  await requireRole(["Super Admin", "Accountant", "Principal"]);
  const rc = await getRoleContext();
  const canWrite = rc?.isFinanceStaff || false;
  const supabase = await createClient();

  const [{ data: rules }, { data: teachers }, { data: classes }, { data: sections }] = await Promise.all([
    supabase.from("salary_rules").select("id, percentage, active, effective_from, teacher_id, teacher:teachers(name), class:classes(name), section:sections(name)").order("created_at", { ascending: false }),
    supabase.from("teachers").select("id, name").eq("status", "active").order("name"),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("sections").select("id, name, class_id").order("name"),
  ]);

  // Each rule's full rate history — 0025_salary_rule_history.sql logs a
  // new segment every time a percentage actually changes, so a rule with
  // more than one segment here is exactly the "August 60% / September 65%"
  // case worth showing.
  const { data: historyByRule } = await getSalaryRuleHistoryByRuleIds((rules || []).map((r) => r.id));

  // Grouped by teacher for display, matching how you'd actually think about
  // it — "what does Ahmad's whole rate sheet look like" rather than one
  // flat table of unrelated rows.
  const byTeacher = {};
  (rules || []).forEach((r) => {
    const key = r.teacher_id;
    (byTeacher[key] ||= { name: r.teacher?.name || "—", rules: [] }).rules.push(r);
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Salary Configuration</h1>
      <p className="text-sm text-slate-500 mt-1">
        Percentage rules — teacher × class × section → percentage of that class's actual collection. Every rate change
        is kept as history, so a payroll month already generated never silently changes when a later rate is set.
      </p>

      <div className="mt-6">
        {canWrite ? (
          <SalaryRuleForm teachers={teachers} classes={classes} sections={sections} />
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-6">
            You can view salary rules, but only Super Admin or Accountant can change them.
          </div>
        )}
      </div>

      <div className="space-y-5">
        {Object.entries(byTeacher).map(([teacherId, group]) => (
          <div key={teacherId} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-ink mb-3">Teacher: {group.name}</div>
            <div className="space-y-3">
              {group.rules.map((r) => {
                const history = historyByRule?.[r.id] || [];
                const hasHistory = history.length > 1;
                return (
                  <div key={r.id} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-ink">
                        {r.class?.name}{r.section?.name ? ` — ${r.section.name}` : " (Whole class)"}
                        <span className="font-mono font-medium ml-2">{r.percentage}%</span>
                        {!r.active && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">inactive</span>}
                      </div>
                      <div className="text-xs text-slate-400">Effective: {fmtDate(r.effective_from)}</div>
                    </div>
                    {hasHistory && (
                      <div className="mt-1.5 pl-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                        {history.map((h) => (
                          <span key={h.effective_from}>
                            {fmtMonth(h.effective_from)}: <span className="font-mono">{h.percentage}%</span>
                            {h.effective_to ? "" : " (current)"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {(!rules || rules.length === 0) && (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
            No percentage rules yet.
          </div>
        )}
      </div>
    </div>
  );
}
