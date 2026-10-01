-- ============================================================================
-- 23. ATTENDANCE READ SCOPING — a real RLS gap found while tracing the test
-- scenario "Teacher attempts another teacher's attendance → should be
-- denied":
--
-- Both student_attendance and teacher_attendance had a single blanket
-- policy — "read: any signed-in user" — covering SELECT. The matching
-- write policies were already correctly scoped (a Teacher can only INSERT/
-- UPDATE their own teacher_attendance row, or student_attendance rows for
-- classes they're assigned to, via teacher_classes) — but nothing stopped
-- a Teacher from simply *reading* every other teacher's attendance record,
-- or every student's, regardless of class assignment. That fails the
-- stated scope ("Teacher: own classes, student attendance" — not
-- everyone's), and it's reachable today, not hypothetical: Attendance
-- Reports already queries these tables directly.
--
-- Fix: replace the blanket read policy on each table with two narrower
-- ones — full read for admin/finance-oversight roles (Super Admin,
-- Principal, Accountant — matches can_view_finance()), and a Teacher-scoped
-- read (their own row for teacher_attendance; their assigned classes'
-- students for student_attendance). Cashier has no stated stake in
-- attendance at all, so — correctly — neither new policy grants them
-- anything.
-- ============================================================================

drop policy if exists "read: any signed-in user" on teacher_attendance;

create policy "admin/finance view all teacher attendance" on teacher_attendance
  for select using (is_admin() or can_view_finance());

create policy "teacher views own attendance" on teacher_attendance
  for select using (teacher_id = current_teacher_id());

drop policy if exists "read: any signed-in user" on student_attendance;

create policy "admin/finance view all student attendance" on student_attendance
  for select using (is_admin() or can_view_finance());

create policy "teacher views own classes' student attendance" on student_attendance
  for select using (
    exists (select 1 from teacher_classes tc where tc.teacher_id = current_teacher_id() and tc.class_id = student_attendance.class_id)
  );
