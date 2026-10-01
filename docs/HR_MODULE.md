# HR & Employee Management

```
HR
├── Employee master   employees              every staff member — teaching and not
├── Joining            employees.joining_date / probation_end_date
├── Contracts          employee_contracts
├── Documents          employee_documents     external links (no storage bucket yet)
├── Leave              leave_types + leave_requests, apply/approve/reject
├── Attendance         teacher_attendance (reused) / employee_attendance (new)
├── Performance        performance_reviews
├── Training           trainings + training_participants
├── Salary history     read-only view of EXISTING salary_records — no new table
└── Exit/offboarding   employee_exits + offboard_employee()

HR → Attendance → Payroll
```

Routes: `/hr` (directory), `/hr/new`, `/hr/[id]` (one tabbed profile per
employee), `/hr/leave` (approval queue). Super Admin / Principal only.

## HR is separate from payroll — how the two connect

Payroll is teacher-centric by design: `salary_rules`, `salary_records`,
`teacher_attendance` all key on `teachers.id`. HR is broader — it covers
non-teaching staff too — so `employees` is its own table with optional
links: `teacher_id` (points at the payroll-relevant `teachers` row) and
`user_id` (points at a portal login). Neither is required; a new hire with
no login yet is a valid employee.

Payroll itself is untouched: no column, function, or policy of it changed.

### The HR → Attendance → Payroll link

1. **Attendance.** For a teacher-linked employee, HR's Attendance tab reads
   and writes `teacher_attendance` — the *same rows* Payroll already
   reads (`0049`'s absent-day deduction). It is not a copy. Non-teaching
   staff use the new `employee_attendance`.
2. **Leave feeds attendance.** Approving a leave request
   (`decide_leave_request`) writes attendance rows for the dates:
   paid leave type → `leave`, unpaid leave type → `absent`.
3. **Payroll.** Its existing rule (deduct `status = 'absent'` only)
   then does the right thing: paid leave isn't deducted, unpaid leave is,
   with no payroll change. The draft-then-human-approve gate is unchanged.

Rules of that write: Sundays are skipped, and existing attendance marks are
never overwritten (a day already marked present stays present). The Sunday
skip is an assumption — this app has no per-institute working-week
setting — chosen because wrongly marking a non-working day `absent` would
over-deduct pay, while missing one only costs HR a manual correction.

## Things to know

- **Non-teaching staff attendance doesn't feed any payroll**, because this
  app's payroll engine doesn't process non-teaching pay at all. That is a
  payroll-scope question, not an HR one. Their "Salary history" tab shows
  contract salary figures, labeled informational.
- **Existing teachers aren't auto-imported.** Add each employee and link
  their teacher record on `/hr/new` (already-linked teachers/logins are
  filtered out of the pickers).
- **Admin-only reads.** National IDs, addresses, emergency contacts,
  reviews and exit reasons are stricter than this app's usual "any staff"
  default — same tier as payroll.
- **Offboarding** marks the employee `exited` and sets a linked teacher
  `inactive`; salary history is never touched.
- Leave types are seeded per institute (Casual/Sick/Annual/Unpaid) with no
  quotas — no leave policy was invented. Balances/quota enforcement aren't
  built.

## v1 limits

No employee self-service view, no leave balances, no file uploads
(document/contract links only), no leave-type management UI.
