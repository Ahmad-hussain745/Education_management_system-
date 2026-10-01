import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import SubstitutionForm from "./SubstitutionForm";

export default async function SubstitutionsPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: entries }, { data: teachers }, { data: recent }] = await Promise.all([
    supabase.from("timetable_entries").select("id, day_of_week, class:classes(name), subject:subjects(name), teacher:teachers(name), period:periods(name)").eq("status", "published"),
    supabase.from("teachers").select("id, name").eq("status", "active").order("name"),
    supabase.from("timetable_substitutions").select("id, date, reason, entry:timetable_entries(class:classes(name), subject:subjects(name), period:periods(name)), original:teachers!original_teacher_id(name), substitute:teachers!substitute_teacher_id(name)")
      .order("date", { ascending: false }).limit(30),
  ]);

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Substitutions</h1>
      <p className="text-sm text-slate-500 mt-1">Assign a stand-in teacher for a specific date, without changing the published timetable itself.</p>

      <div className="mt-6">
        <SubstitutionForm entries={entries || []} teachers={teachers || []} dayNames={DAY_NAMES} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Class</th><th className="text-left px-4 py-3">Original</th><th className="text-left px-4 py-3">Substitute</th><th className="text-left px-4 py-3">Reason</th></tr>
          </thead>
          <tbody>
            {(recent || []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 whitespace-nowrap">{r.date}</td>
                <td className="px-4 py-3">{r.entry?.class?.name} — {r.entry?.subject?.name} ({r.entry?.period?.name})</td>
                <td className="px-4 py-3 text-slate-500">{r.original?.name || "—"}</td>
                <td className="px-4 py-3 font-medium text-ink">{r.substitute?.name}</td>
                <td className="px-4 py-3 text-slate-500">{r.reason || "—"}</td>
              </tr>
            ))}
            {(!recent || recent.length === 0) && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No substitutions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
