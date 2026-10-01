"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function fmtRs(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}

// One RPC (global_search(), 0031_global_search.sql), one round trip,
// grouped by type in the dropdown. Selecting a student doesn't navigate
// immediately — it opens the mini-card in place (title/class/outstanding +
// Open Profile / Collect Fee / View Statement), so a cashier can act
// without ever leaving whatever page they were already on. Teacher and
// receipt results are simpler: one click is the whole action (open the
// profile, or download the receipt) since neither has a comparable
// multi-action workflow to shortcut.
//
// canViewFees is passed down from the same roleContext the sidebar itself
// is built from (components/AppShell.js) — used only to decide whether to
// render the Collect Fee/View Statement buttons and the Outstanding line;
// the real gate is RLS + the meta.outstanding null-vs-0 distinction the
// SQL function itself already encodes (see 0031's comment on why that
// matters), so hiding a button here is a UX nicety, never the security
// boundary.
export default function GlobalSearch({ canViewFees }) {
  const supabase = createClient();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const handleChange = (value) => {
    setQuery(value);
    setSelectedStudent(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults(null);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.rpc("global_search", { p_query: value, p_limit: 6 });
      setLoading(false);
      setResults(data || []);
      setOpen(true);
    }, 250);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults(null);
    setSelectedStudent(null);
  };

  const students = (results || []).filter((r) => r.result_type === "student");
  const teachers = (results || []).filter((r) => r.result_type === "teacher");
  const receipts = (results || []).filter((r) => r.result_type === "receipt");

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search MSA…"
          className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-soft-blue focus:border-royal transition"
        />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[22rem] bg-white border border-slate-200 rounded-lg shadow-lg max-h-[28rem] overflow-y-auto animate-scale-in">
          {loading && <div className="px-4 py-3 text-sm text-slate-400">Searching…</div>}

          {!loading && selectedStudent && (
            <StudentMiniCard
              student={selectedStudent}
              canViewFees={canViewFees}
              onBack={() => setSelectedStudent(null)}
              onNavigate={(href) => {
                close();
                router.push(href);
              }}
              onClose={close}
            />
          )}

          {!loading && !selectedStudent && (
            <>
              {students.length > 0 && (
                <ResultGroup label="Students">
                  {students.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedStudent(r)}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex flex-col"
                    >
                      <span className="text-sm text-ink font-medium">{r.title}</span>
                      <span className="text-xs text-slate-400">{r.subtitle}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}

              {teachers.length > 0 && (
                <ResultGroup label="Teachers">
                  {teachers.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { close(); router.push(`/teachers/profiles/${r.id}`); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex flex-col"
                    >
                      <span className="text-sm text-ink font-medium">{r.title}</span>
                      <span className="text-xs text-slate-400">{r.subtitle}</span>
                    </button>
                  ))}
                </ResultGroup>
              )}

              {receipts.length > 0 && (
                <ResultGroup label="Receipts">
                  {receipts.map((r) => (
                    <a
                      key={r.id}
                      href={`/api/receipts/${r.id}`}
                      onClick={close}
                      className="block px-4 py-2.5 hover:bg-slate-50"
                    >
                      <span className="text-sm text-ink font-medium block">{r.title}</span>
                      <span className="text-xs text-slate-400">{r.subtitle}</span>
                    </a>
                  ))}
                </ResultGroup>
              )}

              {results && students.length === 0 && teachers.length === 0 && receipts.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-slate-400">No matches for "{query}".</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ label, children }) {
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <div className="px-4 pt-2.5 pb-1 text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
      {children}
    </div>
  );
}

function StudentMiniCard({ student, canViewFees, onBack, onNavigate, onClose }) {
  const meta = student.meta || {};
  return (
    <div className="p-4">
      <button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600 mb-2">← Back to results</button>
      <div className="font-semibold text-ink text-base">{student.title}</div>
      <div className="border-t border-slate-100 my-2" />
      <div className="text-sm text-slate-500">Student</div>
      <div className="text-sm text-ink">{meta.class_name || "—"}{meta.section_name ? `-${meta.section_name}` : ""}</div>
      {canViewFees && (
        <div className="text-sm mt-1">
          <span className="text-slate-500">Outstanding </span>
          <span className={`font-mono font-semibold ${Number(meta.outstanding) > 0 ? "text-brick" : "text-sage"}`}>
            {meta.outstanding == null ? "—" : fmtRs(meta.outstanding)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5 mt-3">
        <button
          type="button"
          onClick={() => onNavigate(`/students/${student.id}`)}
          className="text-sm text-left px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Open Profile
        </button>
        {canViewFees && (
          <>
            <button
              type="button"
              onClick={() => onNavigate(`/fees/payments?student_id=${student.id}`)}
              className="text-sm text-left px-3 py-1.5 rounded-lg bg-royal hover:bg-royal-dark text-white"
            >
              Collect Fee
            </button>
            <a
              href={`/api/student-statements/${student.id}`}
              onClick={onClose}
              className="text-sm text-left px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              View Statement
            </a>
          </>
        )}
      </div>
    </div>
  );
}
