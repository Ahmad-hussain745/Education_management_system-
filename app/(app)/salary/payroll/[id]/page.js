import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SalarySlip from "./SalarySlip";

const FINANCE_TIER = ["Super Admin", "Principal", "Accountant"];

export default async function SalarySlipPage(props) {
  const params = await props.params;
  const supabase = await createClient();
  const recordId = params.id;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("users")
    .select("id, name, role:roles(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { data: record } = await supabase
    .from("salary_records")
    .select("id, month, base_salary, percentage_total, allowances_total, deductions_total, adjustments_total, gross_salary, paid_total, status, locked, teacher_id, teacher:teachers(name, user_id)")
    .eq("id", recordId)
    .maybeSingle();
  if (!record) notFound();

  // Same rule the RLS policy itself enforces ("teacher and principal view
  // salary" in 0002_rls.sql) — this is just the page-level UX version of it,
  // so a teacher who isn't allowed to see this slip gets a clear redirect
  // instead of a page that renders empty because every query got RLS-denied.
  const isFinanceTier = FINANCE_TIER.includes(me?.role?.name);
  const isOwnSlip = record.teacher?.user_id === me?.id;
  if (!isFinanceTier && !isOwnSlip) {
    redirect("/dashboard?denied=1");
  }

  const { data: items } = await supabase
    .from("salary_items")
    .select("id, item_type, students_count, fee_per_student, collected_amount, percentage, amount, note, class:classes(name), section:sections(name)")
    .eq("salary_record_id", recordId)
    .order("created_at");

  return (
    <div className="max-w-2xl">
      <SalarySlip
        record={{ ...record, teacherName: record.teacher?.name }}
        items={items || []}
      />
    </div>
  );
}
