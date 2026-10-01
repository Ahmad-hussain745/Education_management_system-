# Student Risk & Early-Warning System

## The pipeline, mapped onto what's actually here

```
Attendance          student_attendance          last 30 days vs. the 30 before
+
Fee arrears         fee_arrears_filtered()      same function Fee Reports already uses
+
Exam performance    exam_results (published)    latest result vs. the one before it
+
Syllabus progress   syllabus_progress           class-wide completion %, whole institute's pace
+
Teacher observations student_observations       NEW — a short, dated note a teacher logs
    ↓
get_student_risk_signals()  —  one plain-SQL RPC, four independent signals
    ↓
Student Risk
├── Academic     — declining or under 40% on the latest published exam
├── Attendance   — declining or under 75% over the last 30 days
├── Financial    — 2+ months of fee arrears
└── Engagement   — class behind its syllabus pace, and/or a teacher's logged concern
```

## Why four signals, never one score

A blended number ("Risk: 72/100") reads as a verdict — the kind of thing
a Principal accepts or rejects wholesale, without a clear way to check it.
Four separate, plainly-worded signals read the opposite way: each one is
a specific, checkable fact ("attendance is down 15 points from last
month") that a Principal, teacher, or parent can go verify themselves
against Attendance, Exams, Fees, or Syllabus directly. `get_student_risk_
signals()` never combines them into a weighted score, and the UI
(`app/(app)/student-risk/page.js`) always shows all four dimensions for a
flagged student — flagged or not — rather than a single alarming word.

**This is presented as a signal, not a judgment, throughout:**
- The page opens with an explicit banner saying so, not a disclaimer buried in a footnote.
- Signal words are descriptive of a number ("declining", "low", "overdue"), never evaluative of the student.
- Nothing is sent, generated, or acted on automatically. "Recommended next steps" is plain text — three
  possible actions (Teacher review, Parent communication, Academic support), each a **fixed, fully
  auditable consequence of which raw signal fired** (see the `array[...]` in the migration's final
  `select`), not an AI suggestion. There is no button anywhere in this feature that sends a message,
  drafts anything, or changes a record — a human decides what to do with a signal, every time.
- No LLM is involved anywhere in this feature, unlike Ask MSA or Teacher Copilot's generative tools.
  Which named students are struggling is sensitive enough that even the grounded-and-checked phrasing
  step those two features use for less sensitive data doesn't happen here — every word on the page comes
  from a fixed template (`lib/student-risk/format.js`) reading the RPC's own output.
- Only students who actually trip a threshold appear at all — this is a short early-warning list, not
  a full roster with a "risk" column added to it.

## Where "teacher observations" comes from

There was no free-text way for a teacher to log a concern before this
feature — `student_observations` (new table) and a small panel on the
Teacher Copilot page (`ObservationLogger` in `TeacherCopilotClient.js`)
add exactly that: Class → Section → Student → a short note, tagged
Concern / Neutral / Positive. Only `category = 'concern'` notes from the
last 60 days feed the Engagement signal; the others are still saved (a
fuller record, not just a complaint box) but never contribute a flag.

## Access

`get_student_risk_signals()` requires `can_approve()` (Super Admin or
Principal) — the same tier as Fee Reports, because this is the one place
Financial data gets combined with Attendance/Academic/Engagement. Teacher
Copilot's own `risk_signals` tool (see `docs/TEACHER_COPILOT.md`) stays
separate and class-scoped, with no financial dimension — a Teacher's
existing access to their own class's attendance and exam data, nothing
more.

Deliberately **not** `SECURITY DEFINER`: the RPC calls `fee_arrears_
filtered()`, itself a plain, RLS-respecting function. Wrapping the call
in `SECURITY DEFINER` would run that nested call as the function's
owner instead of the signed-in Principal — precisely the kind of
accidental cross-institute exposure `0035_multi_tenancy.sql` exists to
prevent. `can_approve()` is checked explicitly inside the function
instead of relying on privilege escalation to enforce the role gate.
