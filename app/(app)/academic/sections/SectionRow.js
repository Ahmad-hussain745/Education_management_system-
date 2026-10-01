"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSection, deleteSection } from "./actions";

export default function SectionRow({ section, studentCount }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(section.name);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", section.id);
    formData.set("name", name);
    startTransition(async () => {
      const res = await updateSection(formData);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    const warn = studentCount > 0
      ? `${studentCount} student${studentCount === 1 ? "" : "s"} are currently in this section — deleting it will unassign them (they stay enrolled in the class, just without a section). Continue?`
      : `Delete section "${section.name}"? This can't be undone.`;
    if (!confirm(warn)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteSection(section.id);
      if (res?.error) { setError(res.error); return; }
      if (res.unassigned > 0) setMessage(`Deleted — ${res.unassigned} student(s) unassigned from a section.`);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-1.5">
        <form onSubmit={handleSave} className="flex items-center gap-2 flex-1">
          <input value={name} onChange={(e) => setName(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1" />
          <button type="submit" disabled={pending} className="text-xs px-3 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs px-2 py-1 text-slate-500">Cancel</button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between py-1.5 border-t border-slate-100 first:border-t-0">
      <div>
        <span className="text-sm text-ink">{section.name}</span>
        <span className="text-xs text-slate-400 ml-2">{studentCount} student{studentCount === 1 ? "" : "s"}</span>
      </div>
      <div className="space-x-3">
        <button onClick={() => setEditing(true)} className="text-xs text-royal">Edit</button>
        <button onClick={handleDelete} disabled={pending} className="text-xs text-brick">Delete</button>
      </div>
      {error && <p className="text-sm text-brick w-full mt-1">{error}</p>}
      {message && <p className="text-sm text-sage w-full mt-1">{message}</p>}
    </li>
  );
}
