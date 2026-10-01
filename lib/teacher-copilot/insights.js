// The 3 grounded Teacher Copilot tools. Same "AI never writes SQL, only
// calls one approved, parameterized RPC" discipline as Ask MSA's tools
// (lib/assistant/tools.js) — but unlike Ask MSA, nothing here is ever
// handed to an LLM to phrase. Which named students are attendance-
// flagged or exam-failing is sensitive enough that this app doesn't take
// even the grounded-and-checked risk Ask MSA accepts for natural-
// language phrasing; describe() below is a fixed template, full stop.

function pct(n) {
  return n === null || n === undefined ? "—" : `${n}%`;
}

export const INSIGHTS = {
  attendance_insights: {
    async run(supabase, { classId, sectionId }) {
      const { data, error } = await supabase.rpc("get_class_attendance_insights", {
        p_class_id: classId, p_section_id: sectionId || null, p_days: 30,
      });
      if (error) throw new Error(error.message);
      return { rows: data || [] };
    },
    describe(d) {
      if (d.rows.length === 0) return "No attendance has been recorded for this class in the last 30 days.";
      const lines = d.rows.map((r) =>
        `- ${r.student_name}: ${pct(r.attendance_rate)} (${r.present_count} present, ${r.absent_count} absent, ${r.late_count} late, ${r.leave_count} leave, of ${r.total_marked} marked)`
      );
      return `## Attendance — last 30 days\nWorst attendance first.\n\n${lines.join("\n")}`;
    },
  },

  risk_signals: {
    async run(supabase, { classId, sectionId }) {
      const { data, error } = await supabase.rpc("get_class_risk_signals", { p_class_id: classId, p_section_id: sectionId || null });
      if (error) throw new Error(error.message);
      return { rows: data || [] };
    },
    describe(d) {
      if (d.rows.length === 0) return "No students in this class are currently flagged — no one meets the low-attendance, failing, or declining-trend thresholds.";
      const flagLabel = { low_attendance: "Low attendance", failing: "Failing latest exam", declining: "Declining trend" };
      const lines = d.rows.map((r) => {
        const flags = r.risk_flags.map((f) => flagLabel[f] || f).join(", ");
        const examBit = r.latest_exam_pct != null ? ` — ${r.latest_exam_name}: ${pct(r.latest_exam_pct)}${r.prior_exam_pct != null ? ` (was ${pct(r.prior_exam_pct)})` : ""}` : "";
        return `- **${r.student_name}** — ${flags}. Attendance (30d): ${pct(r.attendance_rate_30d)}${examBit}`;
      });
      return `## Students flagged for attention\n${d.rows.length} student${d.rows.length === 1 ? "" : "s"} flagged, most concerning first.\n\n${lines.join("\n")}`;
    },
  },

  progress_summary: {
    async run(supabase, { classId, sectionId, subjectId }) {
      const { data, error } = await supabase.rpc("get_class_progress_summary", {
        p_class_id: classId, p_subject_id: subjectId, p_section_id: sectionId || null,
      }).single();
      if (error) throw new Error(error.message);
      return {
        topicsTotal: data.topics_total, topicsCompleted: data.topics_completed, completionPct: data.completion_pct,
        latestExamName: data.latest_exam_name, avgSubjectPct: data.avg_subject_pct, studentsAssessed: data.students_assessed,
        attendanceRate: data.attendance_rate_30d,
      };
    },
    describe(d) {
      const parts = [];
      parts.push(d.topicsTotal > 0
        ? `**Syllabus:** ${d.topicsCompleted} of ${d.topicsTotal} topics completed (${pct(d.completionPct)}).`
        : "**Syllabus:** No topics have been added for this class/subject yet.");
      parts.push(d.latestExamName
        ? `**Latest exam (${d.latestExamName}):** class average ${pct(d.avgSubjectPct)} across ${d.studentsAssessed} student${d.studentsAssessed === 1 ? "" : "s"} assessed.`
        : "**Latest exam:** No exam has included this subject for this class yet.");
      parts.push(`**Attendance (last 30 days):** ${pct(d.attendanceRate)}.`);
      return `## Progress Summary\n\n${parts.join("\n")}`;
    },
  },
};
