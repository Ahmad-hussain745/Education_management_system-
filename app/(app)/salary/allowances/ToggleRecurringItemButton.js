"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleRecurringItem } from "./actions";

export default function ToggleRecurringItemButton({ id, active }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setPending(true);
    await toggleRecurringItem(id, !active);
    setPending(false);
    router.refresh();
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`text-xs font-medium hover:underline disabled:opacity-50 ${active ? "text-brick" : "text-sage"}`}
    >
      {pending ? "…" : active ? "Turn off" : "Turn on"}
    </button>
  );
}
