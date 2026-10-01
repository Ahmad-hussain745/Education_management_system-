import Link from "next/link";
import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import TransportFeesClient from "./TransportFeesClient";

export default async function TransportFeesPage() {
  const rc = await getRoleContext();
  if (!rc) redirect("/login");
  if (!(rc.isAdmin || rc.isPrincipal || rc.isAccountant || rc.isCashier)) redirect("/dashboard?denied=1");

  const supabase = await createClient();
  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";

  const [{ data: routes }, { data: feeStructures }, { data: records }] = await Promise.all([
    supabase.from("transport_routes").select("id, name").eq("status", "active").order("name"),
    supabase.from("transport_fee_structures").select("id, route_id, monthly_fee"),
    supabase.from("transport_fee_records").select("id, student_id, month, monthly_fee, previous_balance, total_payable, paid_total, status, student:students(name, class:classes(name))")
      .eq("month", currentMonth).order("status"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport" className="text-xs text-slate-400 hover:text-ink">← Transport</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Transport Fees</h1>
        <p className="text-sm text-slate-500 mt-1">
          A separate billing trail from tuition Fees — only students with an active transport assignment are
          billed. Set a monthly fee per route below, then generate this month's bills.
        </p>
      </div>
      <TransportFeesClient routes={routes || []} feeStructures={feeStructures || []} initialRecords={records || []} currentMonth={currentMonth} />
    </div>
  );
}
