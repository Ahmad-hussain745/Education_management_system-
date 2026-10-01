"use client";

import { useState } from "react";
import { setStudentStatus } from "./actions";

export default function DeactivateButton({ studentId, status }) {
  const [pending, setPending] = useState(false);
  const isActive = status === "active";

  const handleClick = async () => {
    const next = isActive ? "inactive" : "active";
    const label = isActive ? "Deactivate" : "Reactivate";
    if (!confirm(`${label} this student? Their fee and payment history is kept either way — students are never deleted.`)) return;
    setPending(true);
    await setStudentStatus(studentId, next);
    setPending(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`text-xs font-medium hover:underline disabled:opacity-50 ${isActive ? "text-brick" : "text-sage"}`}
    >
      {pending ? "…" : isActive ? "Deactivate" : "Reactivate"}
    </button>
  );
}
