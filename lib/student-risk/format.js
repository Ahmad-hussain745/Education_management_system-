// Turns get_student_risk_signals()'s verified row into display text.
// Deliberately plain and factual throughout — "declining", "low",
// "overdue" describe a number, never the student. No dimension is ever
// collapsed into a single word like "at-risk"; all four are always shown,
// flagged or not, so a signal is read next to the fuller picture rather
// than standing alone as a verdict.

export const DIMENSION_LABELS = {
  academic: "Academic",
  attendance: "Attendance",
  financial: "Financial",
  engagement: "Engagement",
};

const SIGNAL_TEXT = {
  attendance: {
    declining: "declining",
    low: "low",
  },
  financial: {
    overdue: "fee arrears (2+ months)",
  },
  academic: {
    declining: "declining",
    failing: "below 40% on the latest result",
  },
  engagement: {
    flagged_and_behind: "teacher concern logged, and the class is behind its syllabus pace",
    teacher_flagged: "a teacher has logged a recent concern",
    behind_syllabus: "the class is behind its syllabus pace",
  },
};

// Order matters here only for display grouping, not severity — these
// are independent signals, not tiers of one score.
export function dedupeActions(actions) {
  return [...new Set(actions || [])];
}

export function describeDimension(dimension, row) {
  if (dimension === "attendance") {
    if (!row.attendance_signal) return { flagged: false, text: `${row.attendance_rate_30d ?? "—"}% present over the last 30 days.` };
    return { flagged: true, text: `${SIGNAL_TEXT.attendance[row.attendance_signal]} — ${row.attendance_rate_30d}% over the last 30 days${row.attendance_rate_prior_30d != null ? ` (was ${row.attendance_rate_prior_30d}% the 30 days before)` : ""}.` };
  }
  if (dimension === "financial") {
    if (!row.financial_signal) return { flagged: false, text: row.months_unpaid > 0 ? `${row.months_unpaid} month(s) unpaid.` : "No outstanding fees." };
    return { flagged: true, text: `${SIGNAL_TEXT.financial[row.financial_signal]} — Rs. ${Math.round(row.total_arrears).toLocaleString("en-US")} across ${row.months_unpaid} months.` };
  }
  if (dimension === "academic") {
    if (!row.latest_exam_pct) return { flagged: false, text: "No published exam result yet." };
    if (!row.academic_signal) return { flagged: false, text: `${row.latest_exam_pct}% on ${row.latest_exam_name}.` };
    return { flagged: true, text: `${SIGNAL_TEXT.academic[row.academic_signal]} — ${row.latest_exam_pct}% on ${row.latest_exam_name}${row.prior_exam_pct != null ? ` (was ${row.prior_exam_pct}%)` : ""}.` };
  }
  if (dimension === "engagement") {
    if (!row.engagement_signal) {
      const bits = [];
      if (row.class_syllabus_completion_pct != null) bits.push(`Class syllabus ${row.class_syllabus_completion_pct}% complete.`);
      if (row.recent_observation_count > 0) bits.push(`${row.recent_observation_count} recent note(s) logged.`);
      return { flagged: false, text: bits.length ? bits.join(" ") : "No signal." };
    }
    const text = SIGNAL_TEXT.engagement[row.engagement_signal];
    const note = row.latest_observation_note ? ` Latest note: "${row.latest_observation_note}"` : "";
    return { flagged: true, text: `${text}.${note}` };
  }
  return { flagged: false, text: "No signal." };
}
