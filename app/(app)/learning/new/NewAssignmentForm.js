"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAssignment, aiDraftAssignment, aiGenerateRubric } from "../actions";
import { DIFFICULTIES } from "@/lib/teacher-copilot/kinds";

const TYPES = ["homework", "classwork", "project", "quiz", "other"];

export default function NewAssignmentForm({ classes }) {
  const router = useRouter();
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [assignmentType, setAssignmentType] = useState("homework");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [maxMarks, setMaxMarks] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [allowLate, setAllowLate] = useState(true);
  const [rubric, setRubric] = useState([]);

  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1]);
  const [objectives, setObjectives] = useState("");
  const [aiPending, setAiPending] = useState(false);
  const [rubricPending, setRubricPending] = useState(false);
  const [error, setError] = useState(null);
  const [submitPending, setSubmitPending] = useState(false);

  const selectedClass = useMemo(() => classes.find((c) => c.classId === classId), [classes, classId]);

  async function draftWithAI() {
    setAiPending(true);
    setError(null);
    try {
      const res = await aiDraftAssignment({
        className: selectedClass?.className, sectionName: selectedClass?.sections.find((s) => s.id === sectionId)?.name,
        subjectName: selectedClass?.subjects.find((s) => s.id === subjectId)?.name, assignmentType, topic, difficulty, objectives,
      });
      if (res.error) setError(res.error);
      else { setTitle(res.draft.title); setDescription(res.draft.description); }
    } finally {
      setAiPending(false);
    }
  }

  async function generateRubric() {
    setRubricPending(true);
    setError(null);
    try {
      const res = await aiGenerateRubric(title, description, maxMarks || null);
      if (res.error) setError(res.error);
      else setRubric(res.rubric);
    } finally {
      setRubricPending(false);
    }
  }

  function updateCriterion(i, field, value) {
    setRubric((r) => r.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  }
  function removeCriterion(i) {
    setRubric((r) => r.filter((_, idx) => idx !== i));
  }
  function addCriterion() {
    setRubric((r) => [...r, { criterion: "", max_points: 0, description: "" }]);
  }

  async function submit() {
    if (!classId || !title.trim()) { setError("Class and title are required."); return; }
    setSubmitPending(true);
    setError(null);
    try {
      const res = await createAssignment({
        classId, sectionId: sectionId || null, subjectId: subjectId || null, assignmentType,
        title, description, maxMarks: maxMarks ? Number(maxMarks) : null, dueDate: dueDate || null,
        allowLate, rubric: rubric.length ? rubric : null,
      });
      if (res.error) setError(res.error);
      else router.push(`/learning/${res.id}`);
    } finally {
      setSubmitPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">
            Class
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); setSubjectId(""); }} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Choose…</option>
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
            Type
            <select value={assignmentType} onChange={(e) => setAssignmentType(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm capitalize">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Max marks (optional)
            <input type="number" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Due date (optional)
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 mt-3">
          <input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />
          Allow late submissions (flagged, not blocked)
        </label>
      </div>

      <div className="bg-royal/5 border border-royal/20 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink mb-2">Draft with AI (optional)</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-slate-600 sm:col-span-2">
            Topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Photosynthesis" className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Difficulty
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Learning objectives (optional)
            <input value={objectives} onChange={(e) => setObjectives(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
          </label>
        </div>
        <button onClick={draftWithAI} disabled={aiPending} className="mt-3 border border-royal text-royal hover:bg-royal/10 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
          {aiPending ? "Drafting…" : "Draft with AI"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="text-xs text-slate-600 block">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600 block">
          Instructions
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm" />
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">Rubric (optional)</h2>
          <button onClick={generateRubric} disabled={rubricPending || !title.trim()} className="text-xs border border-royal text-royal hover:bg-royal/10 px-3 py-1.5 rounded-lg disabled:opacity-60">
            {rubricPending ? "Generating…" : "Generate with AI"}
          </button>
        </div>
        {rubric.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_auto] gap-2 mb-2">
            <input value={c.criterion} onChange={(e) => updateCriterion(i, "criterion", e.target.value)} placeholder="Criterion" className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <input type="number" value={c.max_points} onChange={(e) => updateCriterion(i, "max_points", Number(e.target.value))} placeholder="Points" className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <button onClick={() => removeCriterion(i)} className="text-xs text-slate-400 hover:text-brick px-2">Remove</button>
            <textarea value={c.description} onChange={(e) => updateCriterion(i, "description", e.target.value)} placeholder="Description" className="col-span-3 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" rows={1} />
          </div>
        ))}
        <button onClick={addCriterion} className="text-xs text-slate-500 hover:text-ink">+ Add criterion</button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <button onClick={submit} disabled={submitPending || !classId || !title.trim()} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {submitPending ? "Saving…" : "Save as Draft"}
      </button>
    </div>
  );
}
