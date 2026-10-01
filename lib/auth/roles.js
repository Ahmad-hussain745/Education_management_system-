import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Every boolean here is named after, and computed identically to, the SQL
// function of the same purpose in supabase/migrations/0002_rls.sql
// (is_admin, is_finance_staff, can_view_finance, can_approve,
// can_view_fees). That's deliberate: this file's only job is deciding what
// the UI *offers*, never what's actually *allowed* — RLS is the real
// enforcement layer, running server-side on every query regardless of what
// this returns. If these two definitions ever drift apart, the failure
// mode is "frontend shows a button RLS then rejects" (annoying) rather
// than "frontend hides a control that RLS would have allowed" (also
// annoying, but never a security hole) — so keep the role-name lists here
// byte-for-byte identical to the SQL, not just similar.
//
// PERFORMANCE: this used to run twice on nearly every navigation — once
// from app/(app)/layout.js (for the sidebar) and again from
// lib/auth/guard.js's requireRole() (for the 29 pages that call it) — each
// call doing its own auth.getUser() round trip plus a users query, and
// requireRole() a THIRD query for role alone. Wrapping it in React's
// cache() makes it request-scoped memoization: every call during the same
// render (layout + page + any nested requireRole()) shares one result, so
// the underlying Supabase calls run once per request instead of two or
// three times. requireRole() below was updated to call this instead of
// duplicating the auth check itself — see lib/auth/guard.js.
export const getRoleContext = cache(async function getRoleContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // One round trip instead of two: teachers.user_id references users.id
  // (0002_rls.sql), so PostgREST can embed the matching teacher row(s)
  // directly on this query instead of a second request gated on
  // `roleName === "Teacher"`. There's no uniqueness constraint on
  // teachers.user_id, so PostgREST returns this side as an array — take
  // the first match, same as the old .maybeSingle() effectively did.
  const { data: me } = await supabase
    .from("users")
    .select("id, name, status, institute_id, role:roles(name), teacher:teachers(id), institute:institutes(name, logo_url)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const roleName = me?.role?.name || null;
  const teacherId = roleName === "Teacher" ? me?.teacher?.[0]?.id || null : null;

  // Phase 34 — a Parent's "children" are looked up here, once, the same
  // request-scoped-memoized way as everything else on this object, rather
  // than every portal page separately querying parent_students. RLS
  // (0030_parent_portal.sql's "parent reads own links" policy) already
  // restricts this to the signed-in parent's own rows regardless — this
  // query can't return anyone else's children even if roleName were wrong.
  let children = [];
  if (roleName === "Parent" && me?.id) {
    const { data: links } = await supabase
      .from("parent_students")
      .select("student:students(id, name, student_code, class:classes(name), section:sections(name))")
      .eq("parent_user_id", me.id);
    children = (links || []).map((l) => l.student).filter(Boolean);
  }

  return {
    userId: me?.id || null,
    name: me?.name || null,
    email: user.email,
    status: me?.status || null,
    roleName,
    teacherId,
    instituteId: me?.institute_id || null,
    instituteName: me?.institute?.name || null,
    instituteLogoUrl: me?.institute?.logo_url || null,
    // is_admin()
    isAdmin: roleName === "Super Admin",
    // is_finance_staff()
    isFinanceStaff: roleName === "Super Admin" || roleName === "Accountant",
    // can_view_finance()
    canViewFinance: roleName === "Super Admin" || roleName === "Principal" || roleName === "Accountant",
    // can_approve()
    canApprove: roleName === "Super Admin" || roleName === "Principal",
    // can_view_fees()
    canViewFees: roleName === "Super Admin" || roleName === "Principal" || roleName === "Accountant" || roleName === "Cashier",
    isTeacher: roleName === "Teacher",
    isCashier: roleName === "Cashier",
    isPrincipal: roleName === "Principal",
    isAccountant: roleName === "Accountant",
    // is_admissions_staff() — 20260921031716_admissions_module.sql.
    isAdmissionsStaff: roleName === "Super Admin" || roleName === "Principal" || roleName === "Registrar",
    isRegistrar: roleName === "Registrar",
    // is Parent — the narrowest role (0030_parent_portal.sql's own words).
    // Lives outside (app)/AppShell entirely — see app/(parent)/.
    isParent: roleName === "Parent",
    children,
  };
});
