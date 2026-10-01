"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTopic, updateChapter, deleteChapter } from "./actions";
import TopicRow from "./TopicRow";

export default function ChapterCard({ chapter, sectionId }) {
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [editingChapter, setEditingChapter] = useState(false);
  const [chapterTitle, setChapterTitle] = useState(chapter.title);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const topics = chapter.topics || [];

  // progress is the FULL set of rows per topic (one per section it's ever
  // been tracked for, plus possibly a whole-class row) — pick out the one
  // that matches what's currently selected rather than assuming index 0,
  // otherwise switching sections would silently show the wrong section's
  // ticks (or a different section's completion) as if it were this one's.
  const progressFor = (t) => (t.progress || []).find((p) =>
    sectionId ? p.section_id === sectionId : p.section_id === null
  );

  const completed = topics.filter((t) => progressFor(t)?.completed).length;
  const pct = topics.length > 0 ? Math.round((completed / topics.length) * 100) : 0;

  const handleAddTopic = (e) => {
    e.preventDefault();
    if (!newTopicTitle.trim()) return;
    const formData = new FormData();
    formData.set("chapter_id", chapter.id);
    formData.set("title", newTopicTitle);
    startTransition(async () => {
      const res = await createTopic(formData);
      if (res?.error) { setError(res.error); return; }
      setNewTopicTitle("");
      setAddingTopic(false);
      router.refresh();
    });
  };

  const handleSaveChapter = (e) => {
    e.preventDefault();
    setError("");
    const formData = new FormData();
    formData.set("id", chapter.id);
    formData.set("title", chapterTitle);
    startTransition(async () => {
      const res = await updateChapter(formData);
      if (res?.error) { setError(res.error); return; }
      setEditingChapter(false);
      router.refresh();
    });
  };

  const handleDeleteChapter = () => {
    const warn = topics.length > 0
      ? `Delete "${chapter.title}"? This also removes its ${topics.length} topic${topics.length === 1 ? "" : "s"} and all progress ticked off against them.`
      : `Delete "${chapter.title}"?`;
    if (!confirm(warn)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteChapter(chapter.id);
      if (res?.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
      <div className="flex items-center justify-between">
        {editingChapter ? (
          <form onSubmit={handleSaveChapter} className="flex items-center gap-2 flex-1 mr-3">
            <input value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1" autoFocus />
            <button type="submit" disabled={pending} className="text-xs px-2 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setEditingChapter(false)} className="text-xs px-2 py-1 text-slate-500">Cancel</button>
          </form>
        ) : (
          <div className="font-medium text-ink group flex items-center gap-2">
            {chapter.title}
            <button onClick={() => setEditingChapter(true)} className="text-xs text-royal opacity-0 group-hover:opacity-100">Edit</button>
            <button onClick={handleDeleteChapter} disabled={pending} className="text-xs text-brick opacity-0 group-hover:opacity-100">Delete</button>
          </div>
        )}
        <div className="text-xs text-slate-500 whitespace-nowrap">{topics.length > 0 ? `${completed}/${topics.length} (${pct}%)` : "No topics yet"}</div>
      </div>

      <ul className="mt-2 space-y-1">
        {topics.map((t) => (
          <TopicRow key={t.id} topic={t} done={!!progressFor(t)?.completed} sectionId={sectionId} disabled={pending} />
        ))}
      </ul>

      {addingTopic ? (
        <form onSubmit={handleAddTopic} className="flex items-center gap-2 mt-2">
          <input
            autoFocus value={newTopicTitle} onChange={(e) => setNewTopicTitle(e.target.value)}
            placeholder="Topic title" className="border border-slate-300 rounded-lg px-2 py-1 text-sm flex-1"
          />
          <button type="submit" disabled={pending} className="text-sm px-3 py-1 rounded-lg bg-royal text-white disabled:opacity-60">Add</button>
          <button type="button" onClick={() => setAddingTopic(false)} className="text-sm px-2 py-1 text-slate-500">Cancel</button>
        </form>
      ) : (
        <button onClick={() => setAddingTopic(true)} className="text-xs text-royal mt-2">+ Add Topic</button>
      )}

      {error && <p className="text-sm text-brick mt-2">{error}</p>}
    </div>
  );
}
