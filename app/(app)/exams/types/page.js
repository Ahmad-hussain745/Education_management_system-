import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import ExamTypeList from "./ExamTypeList";

export default async function ExamTypesPage() {
  await requireRole(["Super Admin", "Principal"]);
  const supabase = await createClient();
  const { data: types } = await supabase.from("exam_types").select("id, name").order("name");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Exam Types</h1>
      <p className="text-sm text-slate-500 mt-1">Class Test, Mid Term, Final Term — the categories exams are created under.</p>
      <ExamTypeList types={types || []} />
    </div>
  );
}
