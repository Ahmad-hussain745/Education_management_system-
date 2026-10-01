"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAssignmentStatus, addResource, gradeSubmission, aiSuggestFeedback } from "../actions";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const DIFFICULTY_TEXT = {
  not_enough_data: { label: "Not enough graded submissions yet", tone: "text-slate-500" },
  many_struggled: { label: "Many students scored low — this may have been harder than intended", tone: "text-brick" },
  likely_too_easy: { label: "Most students scored very high with little spread — this may have been easier than intended", tone: "text-amber-700" },
  wide_spread: { label: "A wide spread of results — some students found this much harder than others", tone: "text-amber-700" },
  appropriate: { label: "Results look like a typical, well-matched spread of understanding", tone: "text-sage" },
};

export default function AssignmentDetailClient({ assignment, resources, roster, difficulty, canManage }) {
  const router = useRouter();
  const [status, setStatus] = useState(assignment.status);
  const [statusPending, setStatusPending] = useState(false);
  const [showResourceForm, setShowResourceForm] = useState(false);

  async function togglePublish() {
    const next = status === "draft" ? "published" : "draft";
    setStatusPending(true);
    try {
      const res = await setAssignmentStatus(assignment.id, next);
      if (!res.error) setStatus(next);
    } finally {
      setStatusPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{assignment.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {assignment.class?.name}{assignment.section?.name ? ` (${assignment.section.name})` : ""}{assignment.subject?.name ? ` · ${assignment.subject.name}` : ""}
            {" · "}<span className="capitalize">{assignment.assignment_type}</span>
            {assignment.due_date ? ` · Due ${fmtDate(assignment.due_date)}` : ""}
            {assignment.max_marks ? ` · ${assignment.max_marks} marks` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${status === "published" ? "bg-sage-tint text-sage" : "bg-slate-100 text-slate-500"}`}>{status}</span>
          {canManage && (
            <button onClick={togglePublish} disabled={statusPending} className="text-xs border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg disabled:opacity-60">
              {statusPending ? "…" : status === "draft" ? "Publish" : "Unpublish"}
            </button>
          )}
        </div>
      </div>

      {assignment.description && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Instructions</h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{assignment.description}</p>
        </section>
      )}

      {assignment.rubric?.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Rubric</h2>
          <div className="space-y-2">
            {assignment.rubric.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium text-ink">{c.criterion}</span>
                  {c.description && <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>}
                </div>
                <span className="text-xs font-mono text-slate-500 shrink-0">{c.max_points} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {canManage && difficulty && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Difficulty Analysis</h2>
          <p className={`text-sm font-medium ${DIFFICULTY_TEXT[difficulty.signal]?.tone || "text-slate-500"}`}>
            {DIFFICULTY_TEXT[difficulty.signal]?.label}
          </p>
          {difficulty.graded_count > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {difficulty.graded_count} of {difficulty.total_students} graded · average {difficulty.avg_pct}% · range {difficulty.lowest_pct}–{difficulty.highest_pct}%
              {" · "}{difficulty.pass_count} at/above 40%, {difficulty.fail_count} below
            </p>
          )}
          <p className="text-xs text-slate-400 mt-2">Computed from actual grades below — not an AI opinion.</p>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">Resources</h2>
          {canManage && (
            <button onClick={() => setShowResourceForm((v) => !v)} className="text-xs text-royal hover:underline">
              {showResourceForm ? "Cancel" : "+ Add Resource"}
            </button>
          )}
        </div>
        {showResourceForm && (
          <ResourceForm
            assignmentId={assignment.id} classId={assignment.class_id} sectionId={assignment.section_id} subjectId={assignment.subject_id}
            onDone={() => { setShowResourceForm(false); router.refresh(); }}
          />
        )}
        {resources.length === 0 ? (
          <p className="text-sm text-slate-400">No resources added yet.</p>
        ) : (
          <div className="space-y-2 mt-2">
            {resources.map((r) => (
              <div key={r.id} className="text-sm">
                <span className="font-medium text-ink">{r.title}</span>
                {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-royal ml-2 hover:underline text-xs">Open →</a>}
                {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <h2 className="text-sm font-semibold text-ink p-4 pb-0">Submissions &amp; Grading</h2>
        <div className="divide-y divide-slate-100 mt-2">
          {roster.map((s) => (
            <RosterRow key={s.id} student={s} assignmentId={assignment.id} maxMarks={assignment.max_marks} canManage={canManage} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ResourceForm({ assignmentId, classId, sectionId, subjectId, onDone }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await addResource({ assignmentId, classId, sectionId, subjectId, title, description, url, resourceType: url ? "link" : "note" });
      if (res.error) setError(res.error);
      else onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional)" className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes (optional)" rows={2} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
      {error && <div className="text-xs text-red-700">{error}</div>}
      <button onClick={submit} disabled={pending || !title.trim()} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
        {pending ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

function RosterRow({ student, assignmentId, maxMarks, canManage }) {
  const router = useRouter();
  const sub = student.submission;
  const [marks, setMarks] = useState(sub?.marks_obtained ?? "");
  const [feedback, setFeedback] = useState(sub?.feedback ?? "");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState(null);

  const statusLabel = sub?.status === "graded" ? "Graded" : sub?.status === "submitted" ? (sub.is_late ? "Submitted (late)" : "Submitted") : "Pending";
  const statusColor = sub?.status === "graded" ? "bg-sage-tint text-sage" : sub?.status === "submitted" ? "bg-soft-blue text-royal" : "bg-slate-100 text-slate-500";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await gradeSubmission(assignmentId, student.id, marks, feedback, sub?.submission_type || "physical");
      if (res.error) setError(res.error);
      else router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await aiSuggestFeedback(assignmentId, student.id);
      if (res.error) setError(res.error);
      else setFeedback(res.feedback);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <span className="text-sm font-medium text-ink">{student.name}</span>
        <div className="flex items-center gap-2">
          {sub?.marks_obtained != null && <span className="text-xs font-mono text-slate-500">{sub.marks_obtained}{maxMarks ? `/${maxMarks}` : ""}</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pl-1 space-y-2">
          {(sub?.content_text || sub?.content_url) && (
            <div className="bg-slate-50 rounded-lg p-3 text-sm">
              {sub.content_text && <p className="whitespace-pre-wrap text-ink">{sub.content_text}</p>}
              {sub.content_url && <a href={sub.content_url} target="_blank" rel="noopener noreferrer" className="text-royal text-xs hover:underline">{sub.content_url}</a>}
            </div>
          )}
          {canManage && (
            <>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <input type="number" value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="Marks" className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
                <div className="flex gap-2">
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback" rows={2} className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={suggest} disabled={suggesting} className="text-xs border border-royal text-royal hover:bg-royal/10 px-3 py-1.5 rounded-lg disabled:opacity-60">
                  {suggesting ? "Thinking…" : "Suggest Feedback with AI"}
                </button>
                <button onClick={save} disabled={saving} className="text-xs bg-royal hover:bg-royal-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-60">
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              {error && <div className="text-xs text-red-700">{error}</div>}
            </>
          )}
          {!canManage && sub?.feedback && (
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="text-xs font-medium text-slate-500 mb-1">Feedback</div>
              <p className="text-sm text-ink whitespace-pre-wrap">{sub.feedback}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
