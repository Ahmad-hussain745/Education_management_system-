"use client";

import { useMemo, useState } from "react";
import { generateDraft, decideDraft, listStudentsForClassAction, logObservation, postHomework } from "./actions";
import { DIFFICULTIES } from "@/lib/teacher-copilot/kinds";

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

const STATUS_STYLE = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-sage/10 text-sage border-sage/30",
  discarded: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function TeacherCopilotClient({ classes, kinds, initialDrafts }) {
  const [kindKey, setKindKey] = useState(null);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [students, setStudents] = useState([]);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [objectives, setObjectives] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [activeDraft, setActiveDraft] = useState(null);
  const [drafts, setDrafts] = useState(initialDrafts || []);

  const spec = kindKey ? kinds[kindKey] : null;
  const selectedClass = useMemo(() => classes.find((c) => c.classId === classId), [classes, classId]);

  function chooseKind(key) {
    setKindKey(key);
    setError(null);
    setActiveDraft(null);
    setClassId(""); setSectionId(""); setSubjectId(""); setStudentId(""); setStudents([]);
    setTopic(""); setDifficulty(DIFFICULTIES[1]); setObjectives("");
  }

  async function onClassChange(newClassId) {
    setClassId(newClassId);
    setSectionId(""); setSubjectId(""); setStudentId(""); setStudents([]);
    if (spec?.fields.student && newClassId) {
      const res = await listStudentsForClassAction(newClassId, null);
      if (res.students) setStudents(res.students);
    }
  }

  async function onSectionChange(newSectionId) {
    setSectionId(newSectionId);
    setStudentId(""); setStudents([]);
    if (spec?.fields.student && classId) {
      const res = await listStudentsForClassAction(classId, newSectionId || null);
      if (res.students) setStudents(res.students);
    }
  }

  async function submit() {
    if (!spec) return;
    setPending(true);
    setError(null);
    try {
      const res = await generateDraft(kindKey, {
        classId: classId || null, sectionId: sectionId || null, subjectId: subjectId || null, studentId: studentId || null,
        className: selectedClass?.className || null,
        sectionName: selectedClass?.sections.find((s) => s.id === sectionId)?.name || null,
        subjectName: selectedClass?.subjects.find((s) => s.id === subjectId)?.name || null,
        studentName: students.find((s) => s.id === studentId)?.name || null,
        topic: topic.trim() || null, difficulty: spec.fields.difficulty ? difficulty : null, objectives: objectives.trim() || null,
      });
      if (res.error) { setError(res.error); return; }
      setActiveDraft(res.draft);
      setDrafts((d) => [res.draft, ...d]);
    } finally {
      setPending(false);
    }
  }

  async function decide(id, status) {
    const res = await decideDraft(id, status);
    if (res.error) { setError(res.error); return; }
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, status } : d)));
    if (activeDraft?.id === id) setActiveDraft((d) => ({ ...d, status }));
  }

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-6">
      <div className="space-y-1.5">
        {Object.entries(kinds).map(([key, k]) => (
          <button
            key={key}
            onClick={() => chooseKind(key)}
            className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-sm ${
              kindKey === key ? "border-royal bg-royal/5 text-royal font-medium" : "border-slate-200 bg-white text-ink hover:bg-slate-50"
            }`}
          >
            <div className="font-medium">{k.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.description}</div>
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {!spec && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500">
            Choose a tool on the left to get started.
          </div>
        )}

        {spec && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              {spec.fields.class && (
                <label className="text-xs text-slate-600">
                  Class
                  <select value={classId} onChange={(e) => onClassChange(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
                    <option value="">Choose a class…</option>
                    {classes.map((c) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
                  </select>
                </label>
              )}
              {spec.fields.section && selectedClass?.sections.length > 0 && (
                <label className="text-xs text-slate-600">
                  Section (optional)
                  <select value={sectionId} onChange={(e) => onSectionChange(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
                    <option value="">Whole class</option>
                    {selectedClass.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {spec.fields.subject && (
                <label className="text-xs text-slate-600">
                  Subject
                  <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
                    <option value="">Choose a subject…</option>
                    {(selectedClass?.subjects || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {spec.fields.student && (
                <label className="text-xs text-slate-600">
                  Student
                  <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" disabled={!classId}>
                    <option value="">{classId ? "Choose a student…" : "Choose a class first"}</option>
                    {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {spec.fields.difficulty && (
                <label className="text-xs text-slate-600">
                  Difficulty
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              )}
              {spec.fields.topic && (
                <label className="text-xs text-slate-600 sm:col-span-2">
                  {spec.topicLabel}
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Fractions — adding unlike denominators"
                    className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
                </label>
              )}
              {spec.fields.objectives && (
                <label className="text-xs text-slate-600 sm:col-span-2">
                  {spec.objectivesLabel}
                  <textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={3}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
                </label>
              )}
            </div>

            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            <button
              onClick={submit}
              disabled={pending}
              className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {pending ? "Drafting…" : "Generate Draft"}
            </button>
          </div>
        )}

        {activeDraft && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold text-ink">{kinds[activeDraft.kind]?.label}</div>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[activeDraft.status]}`}>{activeDraft.status}</span>
            </div>
            <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{activeDraft.content}</div>
            {activeDraft.status === "draft" && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => decide(activeDraft.id, "approved")} className="bg-sage hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  Approve
                </button>
                <button onClick={() => decide(activeDraft.id, "discarded")} className="border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2 rounded-lg">
                  Discard
                </button>
              </div>
            )}
          </div>
        )}

        <HomeworkPoster classes={classes} />
        <ObservationLogger classes={classes} />

        {drafts.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-ink mb-2">My Drafts</h2>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {drafts.map((d) => (
                <button key={d.id} onClick={() => setActiveDraft(d)} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">
                      {kinds[d.kind]?.label}{d.className ? ` — ${d.className}${d.sectionName ? ` (${d.sectionName})` : ""}` : ""}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {[d.subjectName, d.topic].filter(Boolean).join(" · ")}{d.subjectName || d.topic ? " · " : ""}{fmtDateTime(d.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Posts to the class's parents via Parent Portal 2.0's Homework tab
// (get_child_homework() reads exactly what's saved here). Its own
// class/section/subject state, separate from the 9 tools above and from
// ObservationLogger below — a different, independent action.
function HomeworkPoster({ classes }) {
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(null);

  const selectedClass = classes.find((c) => c.classId === classId);

  async function submit() {
    if (!classId || !title.trim()) return;
    setPending(true);
    setStatus(null);
    try {
      const res = await postHomework(classId, sectionId || null, subjectId || null, title, description, dueDate || null);
      if (res.error) setStatus({ error: res.error });
      else { setStatus({ ok: true }); setTitle(""); setDescription(""); setDueDate(""); }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-ink">Post Homework</h2>
      <p className="text-xs text-slate-500 mt-1">Visible to parents of this class in their Homework tab as soon as you post it.</p>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <label className="text-xs text-slate-600">
          Class
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); setSubjectId(""); }} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="">Choose a class…</option>
            {classes.map((c) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
          </select>
        </label>
        {selectedClass?.sections.length > 0 && (
          <label className="text-xs text-slate-600">
            Section (optional)
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Whole class</option>
              {selectedClass.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {selectedClass?.subjects.length > 0 && (
          <label className="text-xs text-slate-600">
            Subject (optional)
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              <option value="">—</option>
              {selectedClass.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600">
          Due date (optional)
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      {status?.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{status.error}</div>}
      {status?.ok && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-3">Posted.</div>}

      <button onClick={submit} disabled={pending || !classId || !title.trim()}
        className="mt-3 bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Posting…" : "Post Homework"}
      </button>
    </div>
  );
}

// A short, dated note about a student — the one input to the Student
// Risk & Early-Warning pipeline (docs/STUDENT_RISK.md) that isn't
// already a number somewhere else in this app. Deliberately separate
// from the 9 tools above (its own class/student state) since it isn't
// one of them — it's a record, not an AI draft, and there's nothing to
// approve here; it's saved the moment it's logged.
function ObservationLogger({ classes }) {
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [students, setStudents] = useState([]);
  const [category, setCategory] = useState("concern");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(null); // { ok } | { error }

  const selectedClass = classes.find((c) => c.classId === classId);

  async function onClassChange(newClassId) {
    setClassId(newClassId); setSectionId(""); setStudentId(""); setStudents([]);
    if (newClassId) {
      const res = await listStudentsForClassAction(newClassId, null);
      if (res.students) setStudents(res.students);
    }
  }

  async function onSectionChange(newSectionId) {
    setSectionId(newSectionId); setStudentId(""); setStudents([]);
    if (classId) {
      const res = await listStudentsForClassAction(classId, newSectionId || null);
      if (res.students) setStudents(res.students);
    }
  }

  async function submit() {
    if (!classId || !studentId || !note.trim()) return;
    setPending(true);
    setStatus(null);
    try {
      const res = await logObservation(studentId, classId, sectionId || null, category, note.trim());
      if (res.error) setStatus({ error: res.error });
      else { setStatus({ ok: true }); setNote(""); setStudentId(""); }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-ink">Log a Student Observation</h2>
      <p className="text-xs text-slate-500 mt-1">
        A quick, dated note — attendance, effort, behavior, anything worth remembering. A "Concern" note
        is one of the signals the Student Risk overview looks at; it's never shared with the student or a
        parent from here.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <label className="text-xs text-slate-600">
          Class
          <select value={classId} onChange={(e) => onClassChange(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="">Choose a class…</option>
            {classes.map((c) => <option key={c.classId} value={c.classId}>{c.className}</option>)}
          </select>
        </label>
        {selectedClass?.sections.length > 0 && (
          <label className="text-xs text-slate-600">
            Section (optional)
            <select value={sectionId} onChange={(e) => onSectionChange(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Whole class</option>
              {selectedClass.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600">
          Student
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" disabled={!classId}>
            <option value="">{classId ? "Choose a student…" : "Choose a class first"}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Type
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
            <option value="concern">Concern</option>
            <option value="neutral">Neutral note</option>
            <option value="positive">Positive</option>
          </select>
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Seemed withdrawn in class today, didn't turn in homework."
            className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      {status?.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{status.error}</div>}
      {status?.ok && <div className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2 mt-3">Noted.</div>}

      <button
        onClick={submit}
        disabled={pending || !classId || !studentId || !note.trim()}
        className="mt-3 border border-slate-300 text-ink hover:bg-slate-50 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
      >
        {pending ? "Saving…" : "Log Observation"}
      </button>
    </div>
  );
}
