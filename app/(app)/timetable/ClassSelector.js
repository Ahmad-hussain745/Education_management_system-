"use client";

export default function ClassSelector({ classes, value }) {
  return (
    <select
      defaultValue={value}
      onChange={(e) => { window.location.href = `/timetable?class_id=${e.target.value}`; }}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
    >
      {(classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
