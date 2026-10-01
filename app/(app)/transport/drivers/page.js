import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import DriversClient from "./DriversClient";

export default async function DriversPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: drivers }, { data: linkedEmployeeIds }, { data: employees }] = await Promise.all([
    supabase.from("transport_drivers").select("*").order("name"),
    supabase.from("transport_drivers").select("employee_id").not("employee_id", "is", null),
    supabase.from("employees").select("id, name").neq("status", "exited").order("name"),
  ]);

  const taken = new Set((linkedEmployeeIds || []).map((r) => r.employee_id));
  const availableEmployees = (employees || []).filter((e) => !taken.has(e.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport" className="text-xs text-slate-400 hover:text-ink">← Transport</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Drivers</h1>
      </div>
      <DriversClient drivers={drivers || []} employees={availableEmployees} />
    </div>
  );
}
