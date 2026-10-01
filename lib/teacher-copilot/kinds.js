// The 9 Teacher Copilot tools. `fields` drives which picker controls
// TeacherCopilotClient.js shows for a given tool — the request's
// "Teacher chooses: Class, Subject, Topic, Difficulty, Learning
// objectives" picker, but not every tool needs every field (Attendance
// Insights doesn't take a topic; Progress Summary doesn't take a
// difficulty). `category` decides which pipeline actions.js runs:
// 'generate' calls the LLM and produces new text; 'insight' calls one of
// the three grounded RPCs and never lets an LLM touch the numbers.
export const KINDS = {
  lesson_plan: {
    label: "Lesson Planner",
    category: "generate",
    description: "Draft a lesson plan for one class period.",
    fields: { class: true, section: true, subject: true, topic: true, difficulty: true, objectives: true, student: false },
    topicLabel: "Topic",
    objectivesLabel: "Learning objectives",
  },
  worksheet: {
    label: "Worksheet Generator",
    category: "generate",
    description: "Draft a printable worksheet with an answer key.",
    fields: { class: true, section: true, subject: true, topic: true, difficulty: true, objectives: true, student: false },
    topicLabel: "Topic",
    objectivesLabel: "Learning objectives (optional)",
  },
  quiz: {
    label: "Quiz Generator",
    category: "generate",
    description: "Draft a short in-class quiz with an answer key.",
    fields: { class: true, section: true, subject: true, topic: true, difficulty: true, objectives: true, student: false },
    topicLabel: "Topic",
    objectivesLabel: "Learning objectives (optional)",
  },
  question_bank: {
    label: "Question Generator",
    category: "generate",
    description: "Draft a bank of practice questions on a topic.",
    fields: { class: true, section: true, subject: true, topic: true, difficulty: true, objectives: true, student: false },
    topicLabel: "Topic",
    objectivesLabel: "Learning objectives (optional)",
  },
  differentiated_activities: {
    label: "Differentiated Activities",
    category: "generate",
    description: "Draft Support / On Level / Extension versions of one activity.",
    fields: { class: true, section: true, subject: true, topic: true, difficulty: false, objectives: true, student: false },
    topicLabel: "Topic",
    objectivesLabel: "Learning objectives",
  },
  parent_report: {
    label: "Parent-Report Draft",
    category: "generate",
    description: "Draft a short progress note home about one student.",
    fields: { class: true, section: true, subject: false, topic: true, difficulty: false, objectives: true, student: true },
    topicLabel: "Focus of this report (optional)",
    objectivesLabel: "Notes about this student — attendance, effort, performance, behavior",
  },
  attendance_insights: {
    label: "Attendance Insights",
    category: "insight",
    description: "Per-student attendance over the last 30 days, worst-first.",
    fields: { class: true, section: true, subject: false, topic: false, difficulty: false, objectives: false, student: false },
  },
  risk_signals: {
    label: "Student Risk Signals",
    category: "insight",
    description: "Students showing low attendance, failing marks, or a declining trend.",
    fields: { class: true, section: true, subject: false, topic: false, difficulty: false, objectives: false, student: false },
  },
  progress_summary: {
    label: "Progress Summary",
    category: "insight",
    description: "Syllabus completion, latest exam average, and attendance for a class + subject.",
    fields: { class: true, section: true, subject: true, topic: false, difficulty: false, objectives: false, student: false },
  },
};

export const KIND_KEYS = Object.keys(KINDS);
export const DIFFICULTIES = ["Foundational", "Grade-level", "Advanced"];
