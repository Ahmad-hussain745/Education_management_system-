# Learning Module

```
Learning
├── Homework          unchanged — 20260926010000's simple, ungraded notice
├── Assignments        assignments — the gradable unit: title, instructions,
│                       a rubric, a due date, draft/published
├── Resources          assignment_resources — materials, per assignment or
│                       standalone for a class/subject
├── Submission         assignment_submissions — one row per (assignment,
│                       student); a parent submits online, or a teacher
│                       marks it received
├── Teacher feedback    assignment_submissions.feedback — same row
├── Grades              assignment_submissions.marks_obtained — same row
└── Deadlines           no new table — get_upcoming_deadlines() /
                        get_child_deadlines(), a lens on due_date
```

## Why Submission + Feedback + Grades share one table

A grade and the feedback that explains it are never really two separate
facts about a piece of work — they're recorded, read, and edited together
everywhere in this app's UI. One row per `(assignment_id, student_id)`
(`assignment_submissions`) means there's exactly one place a student's
status for an assignment lives, whether that status came from a parent
submitting online or a teacher marking a paper submission graded directly.

## The state machine, and why it's all in two functions

`assignment_submissions` has **no insert or update RLS policy at all** —
every write goes through `submit_assignment()` (parent) or
`grade_submission()` (teacher), matching the same "an action, not a column
edit" reasoning as `set_teacher_draft_status`/`respond_to_support_request`
from earlier modules. Both are upserts on `(assignment_id, student_id)`:
- `submit_assignment()` refuses to overwrite a submission that's already
  `graded` (a resubmission after grading needs the teacher's attention, not
  a silent overwrite) — enforced by an `ON CONFLICT ... DO UPDATE ... WHERE
  status <> 'graded'`, so a graded row simply doesn't match and the
  function raises a clear `ALREADY_GRADED` error instead.
- `grade_submission()` can create the row if it doesn't exist (a teacher
  grading a paper submission that a parent never logged online) or update
  an existing one — either way it always sets `status = 'graded'` and
  stamps `graded_by`/`graded_at`.

## AI assist — three creative, one deliberately not

```
assignment drafting   ┐
rubrics                 │  LLM drafts, teacher reviews and edits before
feedback suggestions   ┘  saving — same "AI produces a draft, teacher
                            approves" shape as Teacher Copilot
                            (lib/learning/prompts.js, reusing
                            lib/assistant/llm.js's generateDraft — the
                            same client Ask MSA and Teacher Copilot use).

difficulty analysis    →  get_assignment_difficulty() — a DETERMINISTIC
                            SQL function, not an LLM call.
```

Difficulty analysis is grouped with the other three in the request, but
it's fundamentally different: once an assignment has real grades, there
IS a verified answer to "was this too hard" — the class's actual score
distribution. An LLM guessing at difficulty would be strictly less
trustworthy than just computing the average, so it isn't asked. This is
the same choice this app already made for Student Risk Signals
(`docs/STUDENT_RISK.md`) and Teacher Copilot's own risk tool — grounded,
checkable numbers over an AI opinion, wherever a grounded answer exists.
`get_assignment_difficulty()` requires at least 3 graded submissions
before returning a signal at all (`not_enough_data` otherwise) — a class
of 1 or 2 grades isn't a real distribution, and a false signal from noise
would misdirect a teacher's next assignment.

Feedback suggestions are told explicitly to use only what's actually in
the student's submission and the mark given — never to invent an
assessment of effort or a pattern the teacher didn't show it (same
"don't invent a fact you weren't given" rule as every other generative
prompt in this app).

## Access

- **Create/manage** (assignments, resources, grading): `teacher_owns_class()`
  — the same function Teacher Copilot and Parent Portal 2.0's Homework
  panel already use, which also resolves true for Super Admin/Principal.
- **AI drafting a new assignment** (`/learning/new`): Teacher only — same
  scoping decision as Teacher Copilot's own generative tools.
- **Read** (`/learning` list, an assignment's detail page): any active
  staff member, plus Super Admin/Principal oversight.
- **Parent**: only `status = 'published'` assignments for their own
  child's class (`is_parent_of_class()`), and only their own child's
  submission row (`is_parent_of()`).

## What v1 deliberately doesn't do

- No file uploads — a submission is text and/or a link (e.g. a Google
  Drive/Docs link), same scope decision Parent Portal 2.0 made for
  Resources, since this environment has no storage bucket wired up yet.
- No editing an assignment's title/instructions after creation from the
  UI (the underlying `updateAssignment()` action exists for a future
  edit page) — publish/unpublish is the only post-creation control today.
- Grading is per-student, one at a time — no bulk "grade the whole class
  the same" action.

None of these were needed to satisfy the request's tree; natural
follow-ups if a school asks for them.
