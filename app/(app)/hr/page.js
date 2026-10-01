import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLE = {
  active: "bg-sage-tint text-sage",
  on_leave: "bg-amber-50 text-amber-700",
  exited: "bg-slate-100 text-slate-500",
};

export default async function HRPage(props) {
  const searchParams = await props.searchParams;
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  let query = supabase.from("employees").select("id, name, employee_code, designation, department, employment_type, status, joining_date").order("name");
  if (searchParams?.status) query = query.eq("status", searchParams.status);
  const { data } = await query;
  const rows = data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">HR</h1>
          <p className="text-sm text-slate-500 mt-1">Employee master, joining, contracts, documents, leave, performance, training and exits — separate from Payroll.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/hr/leave" className="border border-slate-300 text-ink hover:bg-slate-50 text-sm font-medium px-4 py-2 rounded-lg">Leave Requests</Link>
          <Link href="/hr/new" className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg">Add Employee</Link>
        </div>
      </div>

      <div className="flex gap-1.5">
        {[["", "All"], ["active", "Active"], ["on_leave", "On Leave"], ["exited", "Exited"]].map(([value, label]) => (
          <Link key={value} href={value ? `/hr?status=${value}` : "/hr"}
            className={`text-xs px-3 py-1.5 rounded-lg ${(searchParams?.status || "") === value ? "bg-slate-100 text-ink font-medium" : "text-slate-500 hover:bg-slate-50"}`}>
            {label}
          </Link>
        ))}
      </div>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No employees yet.</p>
        ) : (
          rows.map((e) => (
            <Link key={e.id} href={`/hr/${e.id}`} className="block p-4 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-ink">{e.name}</span>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {e.employee_code ? `${e.employee_code} · ` : ""}{e.designation || "—"}{e.department ? ` · ${e.department}` : ""} · <span className="capitalize">{e.employment_type.replace("_", " ")}</span>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${STATUS_STYLE[e.status]}`}>{e.status.replace("_", " ")}</span>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
