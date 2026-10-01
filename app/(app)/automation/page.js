import { redirect } from "next/navigation";
import { getRoleContext } from "@/lib/auth/roles";
import SuperAdminView from "./SuperAdminView";
import PrincipalView from "./PrincipalView";
import AccountantView from "./AccountantView";
import CashierView from "./CashierView";
import TeacherView from "./TeacherView";

// Phase 25 — one route, five different views, picked by role rather than
// filtering one shared page down. That's deliberate: a Cashier doesn't
// have a smaller VERSION of the Super Admin's job table (they don't care
// when Backup Verification last ran), they have a genuinely different
// set of questions ("did my drawer balance today," "is my last receipt
// synced yet") that the job-table shape doesn't answer well no matter how
// much of it you hide. Same underlying data everywhere (automation_runs,
// staff_notifications, cashier_closings, salary_records, ...) — see each
// view file for exactly what it reads and why.
//
// This file is the ONLY access gate for /automation — each view below
// assumes it was only ever reached through here, the same "page decides
// who's allowed to be looking at this at all" pattern requireRole()
// establishes elsewhere, just expressed as a role→component map instead
// of an allow-list plus a single layout.
export default async function AutomationCenterPage() {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");

  if (roleContext.isAdmin) return <SuperAdminView />;
  if (roleContext.isPrincipal) return <PrincipalView roleContext={roleContext} />;
  if (roleContext.isAccountant) return <AccountantView roleContext={roleContext} />;
  if (roleContext.isCashier) return <CashierView roleContext={roleContext} />;
  if (roleContext.isTeacher) return <TeacherView roleContext={roleContext} />;

  // No recognized role — same fallback requireRole() uses everywhere else.
  redirect("/dashboard?denied=1");
}
