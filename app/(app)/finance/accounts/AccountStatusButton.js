"use client";

import { useState } from "react";
import { setAccountStatus } from "./actions";

export default function AccountStatusButton({ accountId, status }) {
  const [pending, setPending] = useState(false);
  const isActive = status === "active";

  const handleClick = async () => {
    const next = isActive ? "inactive" : "active";
    if (!confirm(`${isActive ? "Deactivate" : "Reactivate"} this account? Its transaction history is kept either way.`)) return;
    setPending(true);
    await setAccountStatus(accountId, next);
    setPending(false);
  };

  return (
    <button onClick={handleClick} disabled={pending} className={`text-xs font-medium hover:underline disabled:opacity-50 ${isActive ? "text-brick" : "text-sage"}`}>
      {pending ? "…" : isActive ? "Deactivate" : "Reactivate"}
    </button>
  );
}
