"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTopic, deleteTopic, setTopicProgress } from "./actions";

export default function TopicRow({ topic, done, sectionId, disabled }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = (checked) => {
    startTransition(async () => {
      const res = await setTopicProgress(topic.id, sectionId || null, checked);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleSave = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", topic.id);
    formData.set("title", title);
    startTransition(async () => {
      const res = await updateTopic(formData);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete topic "${topic.title}"? This removes its progress ticks too.`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteTopic(topic.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  if (editing) {
    return (
      <li className="py-1">
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1" autoFocus />
          <button type="submit" disabled={pending} className="text-xs px-2 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs px-2 py-1 text-slate-500">Cancel</button>
        </form>
        {error && <p className="text-sm text-brick mt-1">{error}</p>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 text-sm group">
      <input type="checkbox" checked={done} onChange={(e) => handleToggle(e.target.checked)} disabled={disabled || pending} />
      <span className={`flex-1 ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>{topic.title}</span>
      <button onClick={() => setEditing(true)} className="text-xs text-royal opacity-0 group-hover:opacity-100">Edit</button>
      <button onClick={handleDelete} disabled={pending} className="text-xs text-brick opacity-0 group-hover:opacity-100">Delete</button>
      {error && <p className="text-sm text-brick w-full">{error}</p>}
    </li>
  );
}
