"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { getConnectivity, subscribeConnectivity } from "@/lib/offline/connectivity";
import { searchStudentsCached } from "@/lib/offline/repositories/students";

// Typeahead replacement for a <select> listing every student — that
// pattern stops working long before 5,000 students (the option list alone
// would be megabytes of HTML). Calls search_students() (0029_scalable_
// listings.sql) per keystroke, debounced, capped at 10 results; selecting
// one calls onSelect({id, name}) and the parent decides what to do with it
// (usually: put student_id in the URL).
//
// OFFLINE: falls back to a plain filter over the cached students table
// (offline/repositories/students.js) instead of the RPC — pass
// instituteId so that fallback knows which cache to search. Callers that
// never operate offline (most of them) can omit instituteId; the fallback
// simply won't be reachable for them since getConnectivity() will be true
// whenever this component is even mounted in a network-required flow.
export default function StudentPicker({ initialName, onSelect, placeholder = "Search student by name or ID…", instituteId }) {
  const supabase = createClient();
  const [query, setQuery] = useState(initialName || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => subscribeConnectivity(setOnline), []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      if (getConnectivity()) {
        const { data } = await supabase.rpc("search_students", { p_query: value, p_limit: 10 });
        setResults(data || []);
      } else {
        const rows = instituteId ? await searchStudentsCached(instituteId, value, 10) : [];
        // Cached rows don't carry class_name (only class_id) — the result
        // list below falls back to student_code for these, same as it
        // already does for any online row missing class_name.
        setResults(rows);
      }
      setLoading(false);
      setOpen(true);
    }, 250);
  };

  const handlePick = (student) => {
    setQuery(student.name);
    setOpen(false);
    onSelect(student);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    onSelect(null);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm pr-7"
        />
        {query && (
          <button type="button" onClick={handleClear} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-auto animate-scale-in">
          {loading && <div className="px-3 py-2 text-sm text-slate-400">Searching{!online ? " cached students…" : "…"}</div>}
          {!loading && results.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No students match{!online ? " in the offline cache" : ""}.</div>}
          {!loading && results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handlePick(s)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2"
            >
              <span className="text-ink">{s.name}</span>
              <span className="text-xs text-slate-400">{s.class_name || s.student_code || ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
