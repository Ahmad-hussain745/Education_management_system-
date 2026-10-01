"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteStudent } from "./actions";

// Same deleteStudent() action as the student detail page's "Delete
// Permanently" button (app/(app)/students/[id]/StudentDetailClient.js) —
// just reachable straight from the list, for the common "added a duplicate
// by mistake, remove it without opening their whole profile" case. The
// safety is entirely in that one server action (fee_payments.student_id is
// `on delete restrict` at the database level, and the action pre-checks
// attendance/fee_records too) — this button adds no logic of its own
// beyond confirming and showing whatever that action says. A plain
// alert() for the refusal message rather than an inline popover: this
// button sits in the last cell of a table row, where an absolutely
// positioned popover risks getting clipped by the card's own
// overflow-hidden for a row near the bottom of the page.
export default function DeleteButton({ studentId, studentName }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (!confirm(`Permanently delete ${studentName}? This can't be undone. If this student has any payment/attendance history, deletion will be refused automatically — use Deactivate instead for a student who's simply left.`)) return;
    setPending(true);
    const res = await deleteStudent(studentId);
    setPending(false);
    if (res?.error) {
      alert(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="text-xs font-medium text-slate-400 hover:text-brick disabled:opacity-50"
      title="Permanently delete — refused automatically if this student has any history"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
