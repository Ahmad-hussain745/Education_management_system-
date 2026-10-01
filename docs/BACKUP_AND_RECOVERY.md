# Backup & Recovery

This isn't a UI module — it's the procedure you follow when something goes wrong, and it
needs to exist *before* the first real deployment, not after the first incident.

```
                    Supabase
                        │
              Database backups (managed)
                        │
             Migration files in GitHub (source of truth for schema)
                        │
                Recovery procedure (this document)
```

**Why two sources of truth, not one:** Supabase's backups capture *data* — every student,
payment, mark, everything that's happened. The `supabase/migrations/*.sql` files in this
repo capture *structure* — every table, function, trigger, and RLS policy, in the exact
order they need to be (re-)applied. Losing the backups loses data but the schema is fully
recoverable from GitHub. Losing GitHub loses the ability to stand up a fresh environment,
but a live database keeps running. Treat both as required, not either/or.

## What Supabase backs up automatically

Every Supabase project (even the free tier) takes daily backups. Paid tiers add
**Point-in-Time Recovery (PITR)**, which lets you restore to any specific minute, not just
the most recent daily snapshot — worth enabling before going live with real student/fee
data, since "someone ran the wrong UPDATE 20 minutes ago" is a PITR problem, not a
daily-backup problem.

Check what you currently have: **Supabase Dashboard → Database → Backups**.

---

## How to restore the database

**Scenario: data is wrong/lost and you need to go back to an earlier point.**

1. **Supabase Dashboard → Database → Backups**
2. Pick either a daily backup or, if PITR is enabled, an exact timestamp
3. Click **Restore** — Supabase does this as a new project or in-place, depending on your
   plan; follow the dialog it shows you
4. **Do not skip this:** after any restore, re-check `supabase/migrations/` against what
   actually exists in the restored database (`select * from schema_migrations` if you're
   tracking that, or just diff table/function lists). A restore to a point in time before
   a migration was applied means that migration needs to be re-run manually.
5. Verify the app still works end-to-end before telling anyone the incident is over: sign
   in, load the Dashboard, open Fee Records — RLS and trigger behavior are exactly the
   kind of thing that can silently regress if a restore lands between two migrations.

**Scenario: you don't have Supabase backups at all (e.g. free tier, backup expired) and
need to rebuild from scratch.** This is why the migrations exist:

1. Create a new Supabase project
2. Run every file in `supabase/migrations/` **in filename order**, 0001 through the
   highest number — this recreates the entire schema, every function, every RLS policy,
   from nothing
3. You will **not** get the data back this way — only the structure. This path is for
   "the project is gone" disasters, not "I want yesterday's numbers back" ones.

---

## How to rotate keys

**When to do this:** a key leaked (committed to a public repo, shared in a screenshot,
former employee had access), or on a routine schedule (recommended: annually, at minimum).

There are three keys. Rotating one doesn't require rotating the others.

### Anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
This one is *meant* to be public — it's shipped to every browser that loads the app. RLS
is what actually protects data, not secrecy of this key. Rotate it if you suspect the
*project itself* needs a clean break (rare), via **Settings → API → Regenerate**. After
regenerating, update it in:
- `.env.local` (local dev)
- Vercel → Project → Settings → Environment Variables
- Redeploy for the change to take effect (env var changes don't apply to already-running
  deployments)

### Service role key (`SUPABASE_SERVICE_ROLE_KEY`)
This one bypasses RLS entirely — treat a leak of this key as a full data breach, not an
inconvenience. Rotate immediately if you have any doubt:
1. **Settings → API → Regenerate service_role key**
2. Update it in Vercel's environment variables **only** — this key must never be in
   `.env.local` if that file is ever committed, never in any client-side code, and never
   logged. Grep the codebase for it before rotating, to confirm nothing hardcoded it:
   `grep -rn "SUPABASE_SERVICE_ROLE_KEY" --include="*.js" app lib` should only show the
   two legitimate reads in `lib/supabase/server.js`'s `createAdminClient()`.
3. Redeploy.

### Database password
Separate from the API keys — this is for direct Postgres connections (e.g. a local `psql`
session), not something this Next.js app uses day-to-day. Rotate via **Settings →
Database → Reset database password** if you've ever shared a direct connection string.

---

## How to recover an admin account

This exact procedure was worked out for real, live, in this project — not theoretical.

**Symptom: "Invalid login credentials"**
The account doesn't exist in Supabase Auth yet, or the password is wrong.
1. **Authentication → Users** — search for the email. If it's not there, create it
   (**Add User**, tick **Auto Confirm User**), then link it:
   ```sql
   insert into users (name, email, role_id, auth_user_id, status)
   values ('Name', 'email@example.com',
     (select id from roles where name = 'Super Admin'),
     'AUTH-USER-UUID-FROM-STEP-ABOVE', 'active');
   ```
2. If the email *is* already listed, use **Reset Password** on that user instead of
   guessing — password mismatches are the most common cause of this exact error.

**Symptom: "This account has been deactivated"**
The linked `users` row has `status != 'active'`. This can't be fixed from inside the app
if it's your only admin account (you can't reach Settings → Users to undo it), so go
straight to SQL Editor:
```sql
update users set status = 'active' where email = 'email@example.com';
```
If that returns **0 rows affected**, the row doesn't exist under that exact email — list
every account to find the real one before assuming the fix didn't work:
```sql
select id, name, email, status, role_id from users order by created_at desc;
```

**No admin account exists at all (true bootstrap loss):** follow "How to restore the
database" above to get back to a point where one did, or repeat the very first bootstrap
step from this README's setup section (**Authentication → Users → Add User**, then the
`insert into users (...)` linking it to `role_id = Super Admin`).

---

## How to deploy a previous version

**Scenario: the latest deploy broke something and you need to go back immediately.**

Fastest path — no git operations needed:
1. **Vercel Dashboard → Project → Deployments**
2. Find the last known-good deployment in the list
3. **⋯ menu → Promote to Production**

This instantly repoints the production URL at that build — seconds, not a rebuild cycle.

To make it permanent (not just roll back the live URL, but also fix `main` going forward):
```bash
git log --oneline          # find the last good commit hash
git revert <bad-commit-hash>   # creates a new commit undoing the bad one
git push
```
Prefer `revert` over `reset --force` on a shared branch — revert preserves history and
doesn't rewrite anything anyone else may have already pulled.

**Important:** rolling back the app code does **not** roll back the database schema. If
the broken deploy included a migration that already ran against production, reverting the
code alone leaves the database ahead of what the reverted code expects. Check whether the
bad deploy added a migration before assuming a code rollback alone fixes things — if it
did, see the next section.

---

## How to roll back a migration

Postgres migrations in this project are forward-only files — there's no `down.sql` for
each one. Rolling one back means writing (and running) the *inverse* SQL by hand, in SQL
Editor, deliberately:

1. **Identify exactly what the migration changed** — open the specific
   `supabase/migrations/NNNN_*.sql` file and read every `create`/`alter`/`drop` in it.
2. **Write the inverse, in reverse order** of the original statements:
   - `create table x` → `drop table x` (only if it's genuinely empty/unwanted — never
     drop a table with real data without a fresh backup first)
   - `alter table x add column y` → `alter table x drop column y`
   - `create policy "..."` → `drop policy "..."`
   - `create trigger`/`create function` → `drop trigger`/`drop function`
3. **Run it in SQL Editor**, then verify: reload the app, exercise the specific feature
   that migration touched, confirm nothing else silently depended on it (check other
   migration files for `references` to anything you just dropped).
4. **Do not delete or renumber the original migration file** in the repo. Add a new file
   instead (e.g. `0030_revert_0028_inventory.sql`) documenting exactly what was undone and
   why. The migrations directory is a permanent history — the goal is to record "this was
   tried and reverted," not to make it look like it never happened.

**If the migration only added things (new tables/functions/policies) and nothing else
depends on them yet** — this is the easy, safe case, and steps 1–3 above are usually a
five-minute job.

**If the migration altered or dropped something that data now depends on** — this is the
hard case, and the honest answer is: restore from a backup taken *before* that migration
ran (see "How to restore the database"), rather than trying to hand-reconstruct dropped
columns/constraints. Don't attempt a live surgical rollback of a destructive migration
against production data without a fresh backup in hand first.

---

## Third leg: optional local encrypted export

Supabase's backups and the migration files above are the real, primary backup —
this is a supplement, for keeping a copy somewhere outside Supabase entirely (a
personal drive, a USB stick in a drawer), the way you might keep a printed copy of
important paperwork.

**Super Admin → Automation Center → Backups → Download an encrypted local copy.**

- Encrypted with AES-256-GCM, key derived from a passphrase you choose at export
  time (PBKDF2, 210,000 iterations). The passphrase is never sent anywhere except
  used once, in memory, to encrypt the file — it isn't stored, logged, or
  recoverable by anyone, including us. **Losing the passphrase means losing the
  export.** Keep it somewhere separate from the file itself.
- Downloads a single `.msabak` file — every student, fee, payment, expense,
  attendance record, and salary record for your institute, as of that moment.
  Nothing is left server-side after the download; the export exists only in that
  one file.
- **Restricted to Super Admin.** No other role can reach the export page or the
  API route behind it — both check independently, so a bug in one doesn't expose
  the other.

**To read a `.msabak` file later:**

```
node scripts/decrypt-export.js path/to/your-institute-backup-2026-09-16.msabak
```

It'll ask for the passphrase and write out a plain `.json` file next to it. That
output file is **unencrypted** — every record in the clear. Delete it once you're
done; don't email it or leave it in a synced folder.

**What this is not:** a scheduled, unattended backup. Automating the encryption
step would mean storing the passphrase somewhere the server can read it
unattended — which defeats the point of a passphrase-only key with no server-side
copy. The daily/weekly/monthly indicators on the Automation Center page are
verification (is the database alive, have row counts unexpectedly dropped), not
this export — see `lib/automation/jobs/backups.js` for why an automated job
literally named "backup" still doesn't take one.
