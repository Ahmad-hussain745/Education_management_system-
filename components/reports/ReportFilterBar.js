"use client";

import { useRouter } from "next/navigation";
import StudentPicker from "@/components/StudentPicker";

// `fields` is an ordered list of which filters this report needs, e.g.
// ["month", "class", "section"]. Each report page passes only the option
// lists it actually has (classes/sections/teachers) — a field is skipped if
// its options weren't provided, rather than rendering an empty picker.
export default function ReportFilterBar({ fields, values, classes, sections, teachers, statusOptions }) {
  const router = useRouter();

  const setParam = (key, value) => {
    const params = new URLSearchParams(values);
    if (value) params.set(key, value);
    else params.delete(key);
    // Changing the class should clear a now-irrelevant section choice.
    if (key === "class_id") params.delete("section_id");
    router.push(`?${params.toString()}`);
  };

  // Free-typed fields (minBalance) push on every keystroke would otherwise
  // remount this server-rendered page mid-type and steal focus/cursor —
  // commit on blur or Enter instead, same end result without the jank.
  const commitOnBlurOrEnter = (key) => ({
    onBlur: (e) => setParam(key, e.target.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") setParam(key, e.target.value);
    },
  });

  const sectionsForClass = (sections || []).filter((s) => !values.class_id || s.class_id === values.class_id);

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6 print:hidden">
      {fields.includes("date") && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input type="date" defaultValue={values.date || ""} onChange={(e) => setParam("date", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      )}
      {fields.includes("month") && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Month</label>
          <input type="month" defaultValue={(values.month || "").slice(0, 7)} onChange={(e) => setParam("month", e.target.value ? `${e.target.value}-01` : "")} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      )}
      {fields.includes("class") && classes && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Class</label>
          <select defaultValue={values.class_id || ""} onChange={(e) => setParam("class_id", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {fields.includes("section") && sections && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
          <select defaultValue={values.section_id || ""} onChange={(e) => setParam("section_id", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All sections</option>
            {sectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {fields.includes("teacher") && teachers && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Teacher</label>
          <select defaultValue={values.teacher_id || ""} onChange={(e) => setParam("teacher_id", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All teachers</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      {fields.includes("student") && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Student</label>
          {/* Typeahead, not a <select> of every student — see
              components/StudentPicker.js. The page passes back
              values.student_name (a single-row lookup by the id already in
              the URL) so a reload still shows the right name here instead
              of a blank box. */}
          <StudentPicker
            initialName={values.student_name || ""}
            placeholder="Select a student…"
            onSelect={(s) => setParam("student_id", s?.id || "")}
          />
        </div>
      )}
      {fields.includes("status") && statusOptions && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
          <select defaultValue={values.status || ""} onChange={(e) => setParam("status", e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {fields.includes("minBalance") && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Minimum Balance</label>
          <input
            type="number"
            min="0"
            step="500"
            inputMode="numeric"
            defaultValue={values.min_balance || ""}
            placeholder="e.g. 5000"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-32"
            {...commitOnBlurOrEnter("min_balance")}
          />
        </div>
      )}
    </div>
  );
}
