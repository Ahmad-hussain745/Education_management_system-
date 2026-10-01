import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";

// Parent added for Parent Portal 2.0's "Report cards" section. Safe the
// same way this file's own header already explains: RLS on every query
// below (exam_results' "parent reads own child's published results",
// students' "parent reads own children", etc. — 0030_parent_portal.sql)
// scopes a parent's session to their own linked children regardless of
// what studentId ends up in the URL. A parent requesting someone else's
// child gets the same 404 an unpublished result already gets.
const ALLOWED = ["Super Admin", "Principal", "Accountant", "Teacher", "Parent"];

function pickGrade(percentage, rules) {
  return (rules || []).find((r) => percentage >= r.min_percentage && percentage <= r.max_percentage)?.grade || "—";
}

// Regenerated from the database on every request, same reasoning as
// /api/receipts, /api/salary-slips, and /api/student-statements — always
// current, nothing cached. Gated on exam_results.status === 'published'
// for THIS student: RLS already limits what the query below can even see,
// this just turns "not published yet" into a clear message instead of a
// PDF full of zeros.
export async function GET(request, props) {
  const params = await props.params;
  const supabase = await createClient();
  const { examId, studentId } = params;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("users").select("role:roles(name)").eq("auth_user_id", user.id).maybeSingle();
  if (!ALLOWED.includes(me?.role?.name)) {
    return NextResponse.json({ error: "Not authorized to view report cards." }, { status: 403 });
  }

  const [{ data: exam }, { data: student }, { data: result }, { data: gradeRules }] = await Promise.all([
    supabase.from("exams").select("name").eq("id", examId).maybeSingle(),
    supabase.from("students").select("name, student_code, class:classes(name), section:sections(name)").eq("id", studentId).maybeSingle(),
    supabase
      .from("exam_results")
      .select("total_marks, total_max_marks, percentage, class_rank, status, grade_rule:grade_rules(grade, remarks)")
      .eq("exam_id", examId).eq("student_id", studentId).maybeSingle(),
    supabase.from("grade_rules").select("grade, min_percentage, max_percentage").order("min_percentage", { ascending: false }),
  ]);

  if (!exam || !student) return NextResponse.json({ error: "Exam or student not found." }, { status: 404 });
  if (!result || result.status !== "published") {
    return NextResponse.json({ error: "This student's result hasn't been published yet." }, { status: 403 });
  }

  const { data: marks } = await supabase
    .from("exam_marks")
    .select("marks_obtained, is_absent, exam_subject:exam_subjects!inner(exam_id, max_marks, subject:subjects(name))")
    .eq("student_id", studentId)
    .eq("exam_subject.exam_id", examId);

  const subjectRows = (marks || []).map((m) => ({
    name: m.exam_subject?.subject?.name || "—",
    obtained: m.is_absent ? null : Number(m.marks_obtained),
    max: Number(m.exam_subject?.max_marks || 0),
  }));

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([320, 620]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.16);
  const slate = rgb(0.42, 0.45, 0.5);
  const royal = rgb(0.16, 0.24, 0.55);
  const MARGIN = 24, RIGHT = 320 - MARGIN;
  let y = 580;
  const ensureRoom = (needed) => {
    if (y - needed < 30) {
      page = pdf.addPage([320, 620]);
      y = 580;
    }
  };

  page.drawText("Modern Science Academy", { x: MARGIN, y, size: 11, font: bold, color: royal });
  y -= 14;
  page.drawText("Report Card — " + exam.name, { x: MARGIN, y, size: 9, font, color: slate });
  y -= 22;

  page.drawText(student.name, { x: MARGIN, y, size: 13, font: bold, color: ink });
  y -= 14;
  const sub = `${student.student_code || "no ID assigned"} — ${student.class?.name || ""}${student.section?.name ? ` ${student.section.name}` : ""}`;
  page.drawText(sub, { x: MARGIN, y, size: 8, font, color: slate });
  y -= 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;

  const cols = [
    { label: "Subject", x: MARGIN, w: 150 },
    { label: "Marks", x: MARGIN + 150, w: 60, right: true },
    { label: "Grade", x: MARGIN + 210, w: 62, right: true },
  ];
  cols.forEach((c) => page.drawText(c.label, { x: c.right ? c.x + c.w - font.widthOfTextAtSize(c.label, 7) : c.x, y, size: 7, font, color: slate }));
  y -= 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
  y -= 12;

  for (const s of subjectRows) {
    ensureRoom(16);
    const marksText = s.obtained === null ? "Absent" : `${s.obtained} / ${s.max}`;
    const pct = s.obtained === null ? 0 : s.max > 0 ? (s.obtained / s.max) * 100 : 0;
    const gradeText = s.obtained === null ? "—" : pickGrade(pct, gradeRules);
    const values = [s.name, marksText, gradeText];
    cols.forEach((c, i) => {
      const text = values[i];
      const w = font.widthOfTextAtSize(text, 8);
      page.drawText(text, { x: c.right ? c.x + c.w - w : c.x, y, size: 8, font, color: ink });
    });
    y -= 16;
  }

  ensureRoom(90);
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;

  const summary = [
    ["Total", `${result.total_marks} / ${result.total_max_marks}`],
    ["Percentage", `${result.percentage}%`],
    ["Grade", result.grade_rule?.grade || "—"],
    ["Class Rank", result.class_rank ? String(result.class_rank) : "—"],
  ];
  for (const [label, value] of summary) {
    page.drawText(label, { x: MARGIN, y, size: 9, font, color: slate });
    const w = bold.widthOfTextAtSize(value, 9);
    page.drawText(value, { x: RIGHT - w, y, size: 9, font: bold, color: ink });
    y -= 16;
  }
  if (result.grade_rule?.remarks) {
    y -= 4;
    page.drawText(result.grade_rule.remarks, { x: MARGIN, y, size: 8, font, color: slate });
  }

  const bytes = await pdf.save();
  const safeName = (student.student_code || student.name || "report-card").replace(/\s+/g, "-");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-card-${safeName}.pdf"`,
    },
  });
}
