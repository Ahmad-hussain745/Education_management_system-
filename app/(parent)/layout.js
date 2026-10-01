import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import ParentShell from "@/components/ParentShell";

// Phase 34 — the frontend half of 0030_parent_portal.sql, which built the
// Parent role, parent_students linking table, and every RLS policy a
// parent needs (own children, own child's class/section/attendance/fees/
// payments/syllabus/published exam results/notifications) but never got a
// page put in front of it. Deliberately its own route group, not a
// narrower view bolted onto (app)/AppShell — a parent's nav has nothing
// in common with a staff member's, and reusing that shell would mean
// hiding 20 nav items instead of just not building them here.
export default async function ParentLayout({ children }) {
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");

  if (roleContext.status !== "active") {
    (await createClient()).auth.signOut();
    redirect("/login?deactivated=1");
  }

  // Mirrors (app)/layout.js's own redirect back at Parents — same
  // reasoning in reverse: this shell is wrong for everyone who isn't one.
  if (!roleContext.isParent) redirect("/dashboard");

  return (
    <Suspense fallback={null}>
      <ParentShell
        instituteName={roleContext.instituteName}
        instituteLogoUrl={roleContext.instituteLogoUrl}
        parentName={roleContext.name}
        children_={roleContext.children}
      >
        {children}
      </ParentShell>
    </Suspense>
  );
}
