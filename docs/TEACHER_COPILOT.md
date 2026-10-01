# Teacher Copilot

Nine tools, in two families:

```
Teacher Copilot
├── Lesson planner              ┐
├── Worksheet generator         │  GENERATIVE — LLM drafts content from
├── Quiz generator              │  a brief (Class, Subject, Topic,
├── Question generator          │  Difficulty, Learning objectives).
├── Differentiated activities   │  Saved as status='draft'; never shown
├── Parent-report draft         ┘  to a student/parent until approved.
│
├── Attendance insights         ┐  GROUNDED — one authorized RPC each,
├── Student risk signals        │  same discipline as Ask MSA. Rendered
└── Progress summary            ┘  by a fixed template, never LLM-phrased.
```

## Teacher chooses → AI produces a draft → Teacher approves

The picker (`TeacherCopilotClient.js`) shows only the fields a given tool
actually needs (`lib/teacher-copilot/kinds.js#KINDS[kind].fields`) — a
lesson plan asks for Class/Subject/Topic/Difficulty/Learning objectives;
Attendance Insights only asks for Class. Every option in the picker comes
from the teacher's own `teacher_classes` rows (`lib/teacher-copilot/
roster.js`) — there's no free-text class name to resolve the way Ask MSA
has to, because the teacher is picking from real rows the UI already
fetched for them.

Every result, generative or grounded, is written to
`teacher_copilot_drafts` with `status = 'draft'` by `create_teacher_draft()`.
**Nothing in this app reads that content anywhere else until the teacher
who requested it calls `decideDraft(id, 'approved')`** — there's no
downstream "publish to students" wired to any status but `approved`, and
even the read-only oversight view Principals/Super Admins get
(`can_approve()`'s RLS policy on the table) is separate from approval —
seeing a draft isn't the same as it being live.

## Why the two families are treated so differently

A lesson plan doesn't have a "verified" version to check the AI's writing
against — the safety mechanism for the generative tools is the workflow
itself (draft → teacher review → explicit approve), same shape as
`docs/ASK_MSA_COPILOT.md` describes for content Ask MSA can't ground
either.

The three grounded tools are different: "which named students are
attendance-flagged or exam-failing" is real, checkable, sensitive data,
and it's available — via `get_class_attendance_insights()`,
`get_class_risk_signals()`, `get_class_progress_summary()` — the exact
same way Ask MSA's tools are: one parameterized, authorized RPC per
tool, `teacher_owns_class()` checked first, no SQL composed anywhere.
Unlike Ask MSA, though, these are **never** handed to an LLM to phrase —
`lib/teacher-copilot/insights.js#describe()` is a fixed template. Ask
MSA accepts a grounded-and-checked LLM phrasing step because its numbers
are institutional aggregates; a Teacher Copilot risk-signal answer names
specific children, and that's a line this app draws more conservatively
even with the same grounding check available.

## Risk signals, precisely

`get_class_risk_signals()` flags a student for exactly three reasons, and
only these three:
- `low_attendance` — under 75% present/late over the last 30 days
- `failing` — latest **published** exam result under 40%
- `declining` — latest published result at least 10 points below the one
  before it

No blended score, no hidden weighting. A student is flagged with one of
these three words, and a teacher, Principal, or parent asking "why" can
go check that exact underlying number themselves in Attendance or Exams.
