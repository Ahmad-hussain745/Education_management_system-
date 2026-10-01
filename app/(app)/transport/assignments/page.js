import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import AssignmentsClient from "./AssignmentsClient";

export default async function AssignmentsPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: routes }, { data: assignments }, { data: students }] = await Promise.all([
    supabase.from("transport_routes").select("id, name, status, stops:transport_stops(id, name, sequence_order)").eq("status", "active").order("name"),
    supabase.from("transport_assignments").select("id, student_id, stop_id, student:students(name, class:classes(name)), route:transport_routes(name)").eq("status", "active").order("created_at", { ascending: false }),
    supabase.from("students").select("id, name, class:classes(name)").eq("status", "active").order("name").limit(500),
  ]);

  const assignedIds = new Set((assignments || []).map((a) => a.student_id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transport" className="text-xs text-slate-400 hover:text-ink">← Transport</Link>
        <h1 className="text-xl font-semibold text-ink mt-1">Transport Assignments</h1>
        <p className="text-sm text-slate-500 mt-1">Which route (and stop) each student rides. A student can only have one active assignment — reassigning ends the previous one automatically.</p>
      </div>
      <AssignmentsClient routes={routes || []} assignments={assignments || []} students={students || []} assignedIds={[...assignedIds]} />
    </div>
  );
}
