// Populates the Class/Section/Subject picker from teacher_classes —
// never free text (unlike Ask MSA's resolve.js, there's no fuzzy
// matching needed here: the teacher picks from real rows the UI already
// fetched, so every id the picker can submit already IS a real,
// belongs-to-this-teacher id before validation even runs).
export async function getTeacherClasses(supabase, teacherId) {
  const { data, error } = await supabase
    .from("teacher_classes")
    .select("class_id, section_id, subject_id, class:classes(name), section:sections(name), subject:subjects(name)")
    .eq("teacher_id", teacherId);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    classId: r.class_id, className: r.class?.name || "Class",
    sectionId: r.section_id, sectionName: r.section?.name || null,
    subjectId: r.subject_id, subjectName: r.subject?.name || null,
  }));
}

// Rows from teacher_classes are one-per-(class,section,subject) — this
// collapses them into what the picker actually needs: one entry per
// class, with the distinct sections and subjects available under it.
export function groupTeacherClasses(rows) {
  const byClass = new Map();
  for (const r of rows) {
    if (!byClass.has(r.classId)) byClass.set(r.classId, { classId: r.classId, className: r.className, sections: new Map(), subjects: new Map() });
    const entry = byClass.get(r.classId);
    if (r.sectionId) entry.sections.set(r.sectionId, r.sectionName);
    if (r.subjectId) entry.subjects.set(r.subjectId, r.subjectName);
  }
  return [...byClass.values()].map((e) => ({
    classId: e.classId, className: e.className,
    sections: [...e.sections.entries()].map(([id, name]) => ({ id, name })),
    subjects: [...e.subjects.entries()].map(([id, name]) => ({ id, name })),
  }));
}

export async function getStudentsForClass(supabase, classId, sectionId) {
  let query = supabase.from("students").select("id, name").eq("class_id", classId).eq("status", "active").order("name");
  if (sectionId) query = query.eq("section_id", sectionId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((s) => ({ id: s.id, name: s.name }));
}
