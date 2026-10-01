"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Plain text search, committed on blur or Enter — not on every keystroke.
// Same reasoning as ReportFilterBar's Minimum Balance field: this page is
// server-rendered, so pushing a new URL per character would remount the
// input mid-type and steal focus. Changing the search term always resets
// back to page 1 (page 6 of the old results almost never matches the new
// ones).
export default function SearchBox({ paramKey = "q", placeholder = "Search…" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramKey) || "");

  const commit = (v) => {
    const params = new URLSearchParams(searchParams);
    if (v) params.set(paramKey, v);
    else params.delete(paramKey);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(value);
      }}
      placeholder={placeholder}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64"
    />
  );
}
