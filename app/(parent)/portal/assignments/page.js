import { getRoleContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { resolveSelectedChild } from "@/lib/parent-portal/child";
import { fmtDate } from "@/lib/parent-portal/format";
import SubmitForm from "./SubmitForm";

const STATUS_STYLE = {
  pending: "bg-slate-100 text-slate-500",
  submitted: "bg-soft-blue text-royal",
  graded: "bg-sage-tint text-sage",
};

export default async function AssignmentsPage(props) {
  const searchParams = await props.searchParams;
  const roleContext = await getRoleContext();
  const kids = roleContext?.children || [];
  if (kids.length === 0) return null;
  const child = resolveSelectedChild(searchParams, kids);

  const supabase = await createClient();
  // roleContext.children carries class/section NAMES for display, not
  // their ids (see lib/auth/roles.js) — fetch the child's own class_id/
  // section_id directly (RLS already scopes this to the parent's own
  // child, same as every other query on this page).
  const { data: childRow } = await supabase.from("students").select("class_id, section_id").eq("id", child.id).maybeSingle();

  const [{ data: assignments }, { data: submissions }] = await Promise.all([
    supabase.from("assignments")
      .select("id, title, description, assignment_type, max_marks, due_date, allow_late, status, section_id, subject:subjects(name)")
      .eq("class_id", childRow?.class_id || "").eq("status", "published"),
    supabase.from("assignment_submissions").select("assignment_id, content_text, content_url, is_late, marks_obtained, feedback, status").eq("student_id", child.id),
  ]);

  const submissionByAssignment = new Map((submissions || []).map((s) => [s.assignment_id, s]));
  const rows = (assignments || [])
    .filter((a) => !a.section_id || a.section_id === childRow?.section_id)
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Assignments — {child.name}</h1>

      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">No assignments posted yet.</p>
        ) : (
          rows.map((a) => {
            const sub = submissionByAssignment.get(a.id);
            const status = sub?.status || "pending";
            const canSubmit = status !== "graded" && (a.allow_late || !a.due_date || a.due_date >= today);
            return (
              <div key={a.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-semibold text-ink">{a.title}</span>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {a.subject?.name ? `${a.subject.name} · ` : ""}<span className="capitalize">{a.assignment_type}</span>
                      {a.due_date ? ` · Due ${fmtDate(a.due_date)}` : ""}{a.max_marks ? ` · ${a.max_marks} marks` : ""}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_STYLE[status]}`}>
                    {status === "graded" ? "Graded" : status === "submitted" ? (sub?.is_late ? "Submitted (late)" : "Submitted") : "Not submitted"}
                  </span>
                </div>
                {a.description && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{a.description}</p>}

                {status === "graded" && (
                  <div className="mt-2 bg-sage-tint rounded-lg p-3">
                    <div className="text-sm font-bold text-sage">{sub.marks_obtained}{a.max_marks ? ` / ${a.max_marks}` : ""}</div>
                    {sub.feedback && <p className="text-sm text-ink mt-1 whitespace-pre-wrap">{sub.feedback}</p>}
                  </div>
                )}

                {canSubmit && <SubmitForm assignmentId={a.id} studentId={child.id} existing={sub} />}
                {!canSubmit && status !== "graded" && <p className="text-xs text-brick mt-2">Past due — no longer accepting submissions.</p>}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
