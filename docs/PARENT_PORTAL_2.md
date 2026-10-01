# Parent Portal 2.0

```
Parent Portal
├── Child profile          /portal              (profile card + quick stats)
├── Attendance              /portal/attendance    last 90 days, calendar view
├── Fee balance             /portal              (quick stat) + /portal/fees (full ledger)
├── Payment history         /portal/payments      + "Download Receipt" per payment
├── Online receipt          /api/receipts/[id]     already worked via RLS alone — see below
├── Exam results            /portal/exams          + "Report Card" per published result
├── Report cards            /api/report-cards/[examId]/[studentId]  — Parent added to its allow-list
├── Syllabus progress       /portal/syllabus       get_child_syllabus_progress()
├── Homework                /portal/homework       get_child_homework() — posted from Teacher Copilot
├── Timetable                /portal/timetable      get_child_timetable()
├── Notifications            /portal/notifications  full history (was 5 most recent)
├── Announcements            /portal/announcements  NEW — notice-board feed
└── Support requests         /portal/support        NEW — submit + track
```

## Family switcher — already there, reused everywhere

`ParentShell`'s child switcher (`?child=<id>`, carried across every tab)
predates this feature — Parent Portal 2.0 didn't need to build "Family /
Child A / Child B / Child C" from scratch, only make sure every new page
reads the same `?child=` param the same way. `lib/parent-portal/child.js
#resolveSelectedChild()` is that one shared rule, used by all 11 pages.

## "Strict authorization so a parent sees only linked children" — where that actually lives

Every page here calls `getRoleContext()` for `roleContext.children` — a
list ALREADY scoped to the signed-in parent's own linked children by RLS
(`0030_parent_portal.sql`'s `"parent reads own links"` policy on
`parent_students`) before any portal page code runs. `resolveSelectedChild`
picks one of those; it does not, and structurally cannot, expand that set
— a `?child=` value naming someone else's child simply isn't found in the
list and falls back to the parent's own first child.

Every actual data query then goes through one of two things, never a raw
unscoped table read:
- **Plain RLS** (attendance, fees, payments, exam results, notifications,
  announcements) — `is_parent_of(student_id)` / `is_parent_of_class(class_id)`,
  from `0030_parent_portal.sql`, extended by this migration only for the
  two new tables (`homework`, `announcements`).
- **A `SECURITY DEFINER` function that checks `is_parent_of()` itself**
  (timetable, syllabus progress, homework detail) — used instead of a new
  blanket RLS policy specifically where the underlying table has columns
  a parent should never see. `teachers` holds `phone` and `fixed_salary`
  next to `name`; RLS is row-level, not column-level, so a policy letting
  parents *read* `teachers` rows would hand back the salary column too,
  not just the name a timetable needs. Each function
  (`get_child_timetable`, `get_child_syllabus_progress`,
  `get_child_homework`) does its own authorization check and its own
  joins, and returns only the specific columns a parent should see —
  never the whole row.

## Two things that already worked, unmodified

- **Online receipt** (`/api/receipts/[id]`) has no role gate of its own —
  it relies entirely on `fee_payments`' RLS, which already included a
  parent policy. Nothing needed to change; the Payments page just links
  to it.
- **Report cards** needed one line: `"Parent"` added to the route's
  `ALLOWED` array. The route's own queries were already correctly scoped
  by RLS (`students`, `exam_results`, `exam_marks`'s parent policies) —
  the array was the only thing standing between a parent and their own
  child's report card. Its own file header already explained the
  reasoning this change relies on: RLS decides what the query can see;
  the array just turns "not allowed" into a clear message instead of an
  empty result.

## Homework, Announcements, Support requests — genuinely new

None of these existed before. Where each one's write side lives:
- **Homework**: posted by a teacher from the Teacher Copilot page (`HomeworkPoster`
  — a new panel, separate from the 9 AI tools there), gated by the same
  `teacher_owns_class()` this app already uses for Teacher Copilot's own
  drafts and observations.
- **Announcements**: published by Super Admin/Principal only (`/announcements`)
  — a school-wide or class-wide notice is administrative, not an individual
  teacher's call. Deliberately a separate table from `notifications`
  (per-student system events) and `communication_messages` (individually
  pushed sends) — this is a persistent feed a parent opens and reads, not
  something sent to them.
- **Support requests**: a parent's own words (`create_support_request()`),
  answered by any active staff member (`respond_to_support_request()`,
  `/support`) — no automatic routing, no AI triage; a fixed state machine
  (`open → in_progress/resolved/closed`) a human moves through explicitly.

## What v1 deliberately doesn't do

- Announcements have no edit/retract yet — publish is the only action.
- Homework has no attachment/file support — title, description, due date only.
- Support requests aren't role-routed (e.g. "fees" category to Accountant only) — any staff member can pick any of them up.

None of these were needed to satisfy the request's tree; they're natural
follow-ups if a school actually asks for them.
