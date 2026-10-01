import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/auth/roles";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }) {
  // getRoleContext() is the single source of truth for role flags — the
  // nav below and every page's action-level gating read the same values,
  // computed the same way, so a page can never drift from what the sidebar
  // already implied was allowed.
  const roleContext = await getRoleContext();
  if (!roleContext) redirect("/login");

  // Deactivating a user (Settings → Users) must actually stop them from
  // using the app, not just relabel them in a list — an existing browser
  // session doesn't know their status changed until this check runs. RLS
  // gates what a role can query, but nothing before this gated status at
  // all, so a deactivated user with a live session could keep working
  // right up until every RLS-covered query happened to fail for some other
  // reason. Sign them out and bounce to login the moment this layout runs.
  if (roleContext.status !== "active") {
    (await createClient()).auth.signOut();
    // Three genuinely different situations were being collapsed into one
    // "pending" message:
    //   - userId === null: no `users` row has this auth_user_id AT ALL.
    //     Self-registration (app/register/actions.js) always creates a row
    //     — so this can only happen from the manual, copy-paste-a-UUID
    //     Super Admin bootstrap step (README "Create your first user")
    //     going wrong: a mistyped UUID, the SQL insert never run, or run
    //     against a different Supabase project than this app points at.
    //     That's a broken link, not a queue to wait in — telling someone
    //     in that state "awaiting approval" sends them to wait for
    //     something that will never happen.
    //   - userId set, roleName null: a real pending registration —
    //     registerAccount() always inserts role_id=null, status='inactive'.
    //   - anything else: an existing account a Super Admin deactivated.
    const reason = roleContext.userId === null ? "unlinked" : (roleContext.roleName === null ? "pending" : "deactivated");
    redirect(`/login?${reason}=1`);
  }

  // Parents get their own, much narrower shell entirely — see
  // app/(parent)/layout.js. AppShell below is the staff shell (sidebar,
  // full nav); a Parent landing here (always via /dashboard, since
  // LoginForm.js redirects everyone there regardless of role) is bounced
  // to their actual home before AppShell ever renders.
  if (roleContext.isParent) redirect("/portal");

  return (
    <AppShell
      user={{ name: roleContext.name, email: roleContext.email, role: roleContext.roleName || "Unknown" }}
      roleContext={roleContext}
    >
      {children}
    </AppShell>
  );
}
