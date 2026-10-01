"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import GlobalSearch from "@/components/GlobalSearch";
import OfflineStatus from "@/components/OfflineStatus";
import RealtimeSync from "@/components/RealtimeSync";

// Nav structure matches the sidebar spec, and every group carries a
// `visible` predicate matching the RLS policy that actually governs it in
// 0002_rls.sql — not a rough guess. Where a group's own pages/actions
// narrow further per-role (e.g. Payments still shows to Cashier but the
// fee-configuration items don't), that's handled inside each page itself
// using the same roleContext via getRoleContext()/requireRole(), not here.
function buildNav(rc) {
  const r = rc || {};
  return [
    { href: "/dashboard", label: "Dashboard" },
    // analytics: mirrors the redirect guard in app/(app)/analytics/page.js.
    { href: "/analytics", label: "Analytics", visible: r.isAdmin || r.isPrincipal || r.isAccountant },
    // assistant: same tier as Fee Arrears (Reports) — canViewFees. Salary/
    // inventory/attendance questions are gated further inside the
    // assistant itself (lib/assistant/queries.js), not here.
    { href: "/assistant", label: "Ask MSA", visible: r.isAdmin || r.isPrincipal || r.isAccountant || r.isCashier },
    { href: "/teacher-copilot", label: "Teacher Copilot", visible: r.isTeacher },
    { href: "/learning", label: "Learning", visible: r.isTeacher || r.isAdmin || r.isPrincipal },
    { href: "/hr", label: "HR", visible: r.isAdmin || r.isPrincipal },
    { href: "/leave", label: "Leave", visible: !r.isParent },
    { href: "/transport", label: "Transport", visible: r.isAdmin || r.isPrincipal || r.isAccountant || r.isCashier },
    { href: "/student-risk", label: "Student Risk", visible: r.isAdmin || r.isPrincipal },
    // students: "read: any signed-in user" — everyone.
    { href: "/students", label: "Students" },
    // admissions: is_admissions_staff() — Super Admin, Principal, Registrar.
    // Mirrors requireRole() on every page under this route.
    { href: "/admissions", label: "Admissions", visible: r.isAdmin || r.isPrincipal || r.isRegistrar },
    // timetable: Super Admin/Principal manage it (setup, generate,
    // publish); Teacher/Accountant can view the published grid. Mirrors
    // requireRole() on every page under this route.
    { href: "/timetable", label: "Timetable", visible: r.isAdmin || r.isPrincipal || r.isAccountant || r.isTeacher },
    { href: "/communications", label: "Communications", visible: r.isAdmin || r.isPrincipal || r.isAccountant },
    { href: "/announcements", label: "Announcements", visible: r.isAdmin || r.isPrincipal },
    { href: "/support", label: "Support Requests", visible: true },
    // sync-conflicts: Phase 31. Purely local/per-device data (IndexedDB,
    // never leaves the browser) — any signed-in user can have one (a
    // Teacher's attendance entry, not just a Cashier's payment), so unlike
    // Fee Management this isn't gated by canViewFees.
    { href: "/sync-conflicts", label: "Sync Conflicts" },
    {
      label: "Academic Setup",
      // classes/sections/subjects: "write: admin only" — and nobody's
      // stated scope outside Super Admin includes structural setup.
      visible: r.isAdmin,
      children: [
        { href: "/academic/classes", label: "Classes" },
        { href: "/academic/sections", label: "Sections" },
        { href: "/academic/subjects", label: "Subjects" },
      ],
    },
    {
      label: "Fee Management",
      // fee_records/fee_payments: can_view_fees() = Super Admin, Principal,
      // Accountant, Cashier. Teacher has no read policy on either table at
      // all, so the whole group is pointless (RLS would return nothing) —
      // hide it for Teacher specifically, not just the write-only parts.
      visible: r.canViewFees,
      children: [
        // fee_structures/fee_discounts: "read: finance staff" — Principal
        // and Cashier are excluded even from viewing these, only Super
        // Admin/Accountant. Narrower than the group itself.
        ...(r.isFinanceStaff ? [
          { href: "/fees/structure", label: "Fee Structure" },
          { href: "/fees/overrides", label: "Student Fee Override" },
          { href: "/fees/discounts", label: "Discounts" },
        ] : []),
        // Generate Monthly Fees: same three roles as the RPC itself
        // (Super Admin, Accountant, Cashier) — a different set than the
        // finance-staff-only block above, since Cashier is authorized here
        // but not for Fee Structure/Discounts.
        ...(r.isFinanceStaff || r.isCashier ? [{ href: "/fees/generate", label: "Generate Monthly Fees" }] : []),
        { href: "/fees/records", label: "Fee Records" },
        { href: "/fees/payments", label: "Payments" },
        { href: "/fees/pending", label: "Pending Fees" },
        { href: "/notifications", label: "Notifications" },
        { href: "/fees/receipts", label: "Receipts" },
        { href: "/fees/reports", label: "Fee Reports" },
      ],
    },
    {
      label: "Teachers",
      // teachers/teacher_classes: "read: any signed-in user" — but a
      // Cashier or a Teacher looking at the general staff directory isn't
      // part of either role's stated scope, so keep it to the roles that
      // actually manage staffing.
      visible: r.isAdmin || r.canViewFinance,
      children: [
        { href: "/teachers/profiles", label: "Teacher Profiles" },
        { href: "/teachers/classes", label: "Teacher Classes" },
      ],
    },
    {
      label: "Attendance",
      // Teacher sees only Student Attendance (their own classes, via
      // teacher_classes — already enforced by RLS on the query itself);
      // Cashier isn't part of attendance at all per the stated role scope.
      visible: r.isAdmin || r.canViewFinance || r.isTeacher,
      children: [
        { href: "/attendance/students", label: "Student Attendance" },
        ...(r.isTeacher ? [] : [
          { href: "/attendance/teachers", label: "Teacher Attendance" },
          { href: "/attendance/reports", label: "Attendance Reports" },
        ]),
      ],
    },
    {
      label: "Salary",
      // salary_records/items/payments/rules: Teacher's select policy is
      // scoped to teacher_id = current_teacher_id() (own row only) — so
      // Payroll (linking to their own salary slip) is the only page worth
      // showing them. Cashier has no salary policy at all — hide the group.
      visible: r.isAdmin || r.canViewFinance || r.isTeacher,
      children: [
        ...(r.isTeacher ? [] : [
          { href: "/salary/config", label: "Salary Configuration" },
          { href: "/salary/allowances", label: "Allowances & Deductions" },
        ]),
        { href: "/salary/payroll", label: r.isTeacher ? "My Salary" : "Monthly Payroll" },
        { href: "/salary/slips", label: "Salary Slips" },
        ...(r.isTeacher ? [] : [{ href: "/salary/reports", label: "Salary Reports" }]),
      ],
    },
    {
      label: "Syllabus",
      // syllabus_*: readable by any signed-in user, but only Super Admin or
      // the owning Teacher (via teacher_classes) can actually write —
      // Cashier has no stated stake in curriculum at all.
      visible: !r.isCashier,
      children: [
        { href: "/syllabus/classes", label: "Classes" },
        { href: "/syllabus/subjects", label: "Subjects" },
        { href: "/syllabus/chapters", label: "Chapters" },
        { href: "/syllabus/progress", label: "Progress" },
      ],
    },
    {
      label: "Finance",
      // income/expenses/accounts/etc: "principal views" = can_view_finance()
      // — Cashier is excluded from all of that. But cashier_closings' own
      // RLS (0024_daily_cashier_closing.sql) explicitly includes a Cashier
      // closing their OWN day, so the group itself has to be visible to
      // Cashier too — Cashier Closing is the one child kept outside the
      // canViewFinance-only block below.
      visible: r.canViewFinance || r.isCashier,
      children: [
        ...(r.canViewFinance ? [
          { href: "/finance/income", label: "Income" },
          { href: "/finance/expenses", label: "Expenses" },
          { href: "/finance/accounts", label: "Accounts" },
          { href: "/finance/transactions", label: "Transactions" },
          { href: "/finance/closing", label: "Monthly Closing" },
        ] : []),
        { href: "/finance/cashier-closing", label: "Cashier Closing" },
        ...(r.canViewFinance ? [
          { href: "/finance/reports", label: "Reports" },
        ] : []),
      ],
    },
    {
      label: "Inventory",
      // inventory_*: is_finance_staff() manages everything, can_view_finance()
      // (adds Principal) is read-only — same tier as Fee Structure/Salary
      // Configuration. Neither Cashier nor Teacher has a stated stake in
      // procurement, so unlike Finance above, there's no narrower child kept
      // visible to them — the whole group is hidden.
      visible: r.canViewFinance,
      children: [
        { href: "/inventory/items", label: "Items" },
        { href: "/inventory/categories", label: "Categories" },
        { href: "/inventory/suppliers", label: "Suppliers" },
        { href: "/inventory/purchases", label: "Purchases" },
        { href: "/inventory/stock-in", label: "Stock In" },
        { href: "/inventory/stock-out", label: "Stock Out" },
        { href: "/inventory/stock-report", label: "Stock Report" },
      ],
    },
    {
      label: "Exams",
      // Not required for FinanceOS — 0030_exams_and_results.sql. Setup
      // (Exam Types/Exams/Subjects/Grade Rules) is can_approve() (Super
      // Admin/Principal); Marks is entered by whichever Teacher is actually
      // assigned that class+subject (teacher_classes); Results/Report Cards
      // read is the same scoped tier as exam_marks — full for oversight
      // roles, own-classes-only for a Teacher. Cashier has no stated stake
      // in exams (no RLS policy grants them anything here), so — like
      // Inventory above — the whole group is hidden for them.
      visible: r.canViewFinance || r.isTeacher,
      children: [
        { href: "/exams/types", label: "Exam Types" },
        { href: "/exams", label: "Exams" },
        { href: "/exams/subjects", label: "Subjects" },
        { href: "/exams/marks", label: "Marks" },
        { href: "/exams/grade-rules", label: "Grade Rules" },
        { href: "/exams/results", label: "Results" },
        { href: "/exams/report-cards", label: "Report Cards" },
      ],
    },
    { href: "/reports", label: "Reports" },
    {
      href: "/automation",
      label: "Automation",
      // Phase 25 — visible to everyone now, but what's actually there
      // differs by role (see app/(app)/automation/page.js's dispatcher):
      // Super Admin gets full control, Principal/Accountant get scoped
      // views with limited or no scheduling controls, Cashier/Teacher get
      // an entirely different personal dashboard, not a smaller version
      // of the admin one. The page itself is the real gate (getRoleContext
      // + redirect for anyone unrecognized), same as everywhere else —
      // this `visible` is just about not showing a dead link.
      visible: true,
    },
    {
      label: "Settings",
      // users/roles/audit-log: "admin manages users/roles" — Super Admin
      // only, full stop.
      visible: r.isAdmin,
      children: [
        { href: "/settings/institute", label: "Institute Profile" },
        { href: "/settings/users", label: "Users" },
        { href: "/settings/roles", label: "Roles" },
        { href: "/settings/audit-log", label: "Audit Log" },
      ],
    },
  ].filter((item) => item.visible !== false && (!item.children || item.children.length > 0));
}

function NavGroup({ item, pathname, onNavigate }) {
  const isActiveGroup = item.children?.some((c) => pathname.startsWith(c.href));
  const [open, setOpen] = useState(isActiveGroup);

  if (!item.children) {
    const active = pathname === item.href;
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={`block px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
          active ? "bg-royal text-white shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
          isActiveGroup && !open ? "text-white" : "text-slate-300"
        } hover:bg-white/10 hover:text-white`}
      >
        {item.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {item.children.map((c) => {
            const active = pathname.startsWith(c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={`block px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                  active ? "bg-white/15 text-white font-medium" : "text-slate-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandMark({ compact, name, logoUrl }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${compact ? "w-8 h-8" : "w-9 h-9"} flex-none rounded-full overflow-hidden ring-1 ring-white/20`}>
        <Image src={logoUrl || "/logo.jpg"} alt={`${name || "MSA"} logo`} width={36} height={36} className="w-full h-full object-cover" unoptimized={!!logoUrl} />
      </div>
      <div className="min-w-0">
        <div className="text-[9.5px] font-semibold tracking-[0.15em] uppercase text-blue-300 leading-none">
          MSA FinanceOS
        </div>
        <div className="text-[13px] font-semibold mt-1 leading-none truncate">{name || "Modern Science Academy"}</div>
      </div>
    </div>
  );
}

export default function AppShell({ user, roleContext, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const nav = buildNav(roleContext);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile drawer the moment navigation actually happens, rather
  // than relying on each Link's onClick alone — covers back/forward nav too.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-paper">
      {/* Mounted once here (not per-header, unlike OfflineStatus below,
          which intentionally renders twice for desktop/mobile) — one
          Realtime channel and one toast stack for the whole shell,
          regardless of which header markup is visible at a given
          viewport width. */}
      <RealtimeSync roleContext={roleContext} />
      {/* Backdrop — mobile drawer only */}
      {sidebarOpen && (
        <div
          className="shell-backdrop fixed inset-0 z-30 bg-ink/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex-shrink-0 bg-ink text-white flex flex-col p-3.5 transform transition-transform duration-200 ease-out lg:static lg:translate-x-0 lg:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 px-1 flex items-center justify-between">
          <BrandMark name={roleContext?.instituteName} logoUrl={roleContext?.instituteLogoUrl} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 -mr-1 text-slate-400 hover:text-white"
            aria-label="Close menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          {nav.map((item) => (
            <NavGroup key={item.label} item={item} pathname={pathname} onNavigate={() => setSidebarOpen(false)} />
          ))}
        </nav>

        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2.5">
          <div className="w-8 h-8 flex-none rounded-full bg-royal/40 flex items-center justify-center text-[13px] font-semibold text-white ring-1 ring-white/15">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-white truncate leading-tight">{user.name || user.email}</div>
            <div className="text-[11px] text-slate-400 leading-tight">{user.role}</div>
          </div>
          <button
            onClick={signOut}
            className="flex-none p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Sign out"
            title="Sign out"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 lg:pl-0">
        {/* Mobile top bar — the only way to reach the sidebar once it's an
            off-canvas drawer below the lg breakpoint. Global Search gets its
            own row underneath rather than crowding into this one — there's
            no spare width next to the menu button + logo on a phone. */}
        <header className="lg:hidden sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 -ml-1 rounded-md text-ink hover:bg-slate-100"
              aria-label="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div className="w-6 h-6 flex-none rounded-full overflow-hidden ring-1 ring-soft-blue">
              <Image
                src={roleContext?.instituteLogoUrl || "/logo.jpg"}
                alt={`${roleContext?.instituteName || "MSA"} logo`}
                width={24}
                height={24}
                className="w-full h-full object-cover"
                unoptimized={!!roleContext?.instituteLogoUrl}
              />
            </div>
            <div className="text-[13px] font-semibold text-ink truncate">{roleContext?.instituteName || "Modern Science Academy"}</div>
          </div>
          <div className="px-3.5 pb-2.5 flex items-center gap-2">
            <div className="flex-1 min-w-0"><GlobalSearch canViewFees={!!roleContext?.canViewFees} /></div>
            <OfflineStatus />
          </div>
        </header>

        {/* Desktop top bar — just Global Search; identity/sign-out already
            live at the bottom of the sidebar, no need to duplicate them
            here. */}
        <header className="hidden lg:flex sticky top-0 z-20 items-center gap-3 border-b border-slate-200 bg-white/95 backdrop-blur px-6 py-3">
          <div className="flex-1"><GlobalSearch canViewFees={!!roleContext?.canViewFees} /></div>
          <OfflineStatus />
        </header>

        <main className="flex-1 p-3.5 sm:p-5 lg:p-7 overflow-y-auto">
          {/* key={pathname} forces a remount on every navigation, which is
              what makes .animate-fade-in actually replay each time instead
              of only running once on first load. */}
          <div key={pathname} className="animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
