import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import GradeRuleList from "./GradeRuleList";

export default async function GradeRulesPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();
  const { data: rules } = await supabase.from("grade_rules").select("id, grade, min_percentage, max_percentage, grade_point, remarks").order("min_percentage", { ascending: false });

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Grade Rules</h1>
      <p className="text-sm text-slate-500 mt-1">
        Percentage bands that decide the grade on a Result. Ranges can't overlap — the database rejects
        one that does.
      </p>
      <GradeRuleList rules={rules || []} />
    </div>
  );
}
