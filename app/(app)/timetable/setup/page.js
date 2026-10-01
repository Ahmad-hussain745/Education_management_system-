import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/guard";
import SetupForms from "./SetupForms";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TimetableSetupPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();

  const [{ data: rooms }, { data: periods }, { data: academicDays }, { data: classes }, { data: subjects }, { data: frequencies }] = await Promise.all([
    supabase.from("rooms").select("id, name, capacity, room_type, active").order("name"),
    supabase.from("periods").select("id, name, start_time, end_time, sort_order, is_break").order("sort_order"),
    supabase.from("academic_days").select("day_of_week, active"),
    supabase.from("classes").select("id, name").order("sort_order"),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("subject_frequency").select("id, class_id, subject_id, periods_per_week, max_per_day, class:classes(name), subject:subjects(name)"),
  ]);

  const activeDayMap = Object.fromEntries((academicDays || []).map((d) => [d.day_of_week, d.active]));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Timetable Setup</h1>
      <p className="text-sm text-slate-500 mt-1">
        Rooms, periods, which days are school days, and how many periods/week each subject needs per class —
        the inputs the generator plans against.
      </p>
      <SetupForms
        rooms={rooms || []}
        periods={periods || []}
        activeDayMap={activeDayMap}
        dayNames={DAY_NAMES}
        classes={classes || []}
        subjects={subjects || []}
        frequencies={frequencies || []}
      />
    </div>
  );
}
