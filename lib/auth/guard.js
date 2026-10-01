import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";

// A page-level guard, for the handful of pages where "which nav links are
// shown" isn't precise enough — e.g. a Teacher's ROLE_SECTIONS legitimately
// includes "salary" (their own Salary Reports lives there), but that must
// NOT mean they can load Salary Configuration or Monthly Payroll by typing
// the URL directly, even though both links are already hidden from their nav.
//
// This is still the FRONTEND layer, not the real security boundary — it
// exists so a role sees a clear "you don't have access" redirect instead of
// a page that renders and then has every query/write silently fail against
// RLS. If this guard were ever missing or buggy, RLS in 0002_rls.sql is
// what actually stops the unauthorized read/write, not this function.
//
// PERFORMANCE: this used to run its own auth.getUser() + its own separate
// `users` query on top of what app/(app)/layout.js already does for the
// sidebar — a fully redundant auth round trip on every one of the 29 pages
// that call this. It now goes through the same request-memoized
// getRoleContext() (see lib/auth/roles.js), so on any page that both the
// layout and this guard touch, the actual Supabase calls happen once, not
// twice.
export async function requireRole(allowedRoles) {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");

  const role = roleContext.roleName;
  if (!role || !allowedRoles.includes(role)) {
    redirect("/dashboard?denied=1");
  }
  return role;
}
