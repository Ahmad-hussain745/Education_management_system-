"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Parent Portal 2.0: still deliberately minimal compared to AppShell.js
// (a parent has one family to check on, not twenty modules to navigate),
// but now enough sections that they need real tabs rather than one dense
// page. Every tab link carries the same ?child=<id> the child switcher
// does — plain URL state, no client state to keep in sync with the
// server-rendered data underneath it, and it means a section page never
// has to guess which child was selected on a different page.
const SECTIONS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/attendance", label: "Attendance" },
  { href: "/portal/fees", label: "Fees" },
  { href: "/portal/payments", label: "Payments" },
  { href: "/portal/exams", label: "Exams" },
  { href: "/portal/syllabus", label: "Syllabus" },
  { href: "/portal/homework", label: "Homework" },
  { href: "/portal/assignments", label: "Assignments" },
  { href: "/portal/timetable", label: "Timetable" },
  { href: "/portal/transport", label: "Transport" },
  { href: "/portal/notifications", label: "Notices" },
  { href: "/portal/announcements", label: "Announcements" },
  { href: "/portal/support", label: "Support" },
];

export default function ParentShell({ instituteName, instituteLogoUrl, parentName, children_, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeChildId = searchParams.get("child") || children_?.[0]?.id;

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {instituteLogoUrl ? (
              <img src={instituteLogoUrl} alt="" className="h-8 w-8 rounded object-cover" />
            ) : (
              <div className="h-8 w-8 rounded bg-royal text-white flex items-center justify-center text-sm font-bold">
                {(instituteName || "S")[0]}
              </div>
            )}
            <div>
              <div className="text-sm font-semibold text-ink leading-tight">{instituteName || "School Portal"}</div>
              <div className="text-xs text-slate-400 leading-tight">Parent Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 hidden sm:inline">{parentName}</span>
            <button onClick={signOut} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">
              Sign Out
            </button>
          </div>
        </div>

        {children_ && children_.length > 1 && (
          <div className="max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto pb-2">
            {children_.map((c) => (
              <a
                key={c.id}
                href={`${pathname}?child=${c.id}`}
                className={`shrink-0 text-sm px-3 py-1.5 rounded-full border ${
                  c.id === activeChildId
                    ? "bg-royal text-white border-royal"
                    : "bg-white text-slate-600 border-slate-300"
                }`}
              >
                {c.name}
              </a>
            ))}
          </div>
        )}

        {children_ && children_.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto pb-2 border-t border-slate-100 pt-2">
            {SECTIONS.map((s) => (
              <a
                key={s.href}
                href={`${s.href}${activeChildId ? `?child=${activeChildId}` : ""}`}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-lg ${
                  pathname === s.href ? "bg-slate-100 text-ink font-medium" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s.label}
              </a>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {(!children_ || children_.length === 0) ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            No student is linked to this account yet. Contact the school office to have your child linked to your parent account.
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
