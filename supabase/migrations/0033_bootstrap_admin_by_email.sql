-- ============================================================================
-- 33. BOOTSTRAP FIRST ADMIN BY EMAIL — remove the copy-paste-a-UUID step
--
-- README's "Create your first user" step asks someone to copy a UUID out of
-- the Supabase dashboard and paste it into a raw INSERT by hand. That's a
-- real failure surface: a mistyped/truncated UUID, pasting the wrong user's
-- ID, or running the insert against a different project than the app
-- actually points at all produce the exact same symptom — the person can
-- sign in to Supabase Auth with the right password, but
-- app/(app)/layout.js finds no matching `users` row (auth_user_id doesn't
-- match anything) and bounces them straight back to /login. As of this
-- migration's app-side companion change, that specific case shows a clear
-- "no account record is linked to this login" message instead of a
-- misleading "awaiting approval" one — but the better fix is removing the
-- copy-paste step that causes it in the first place.
--
-- This function looks the auth user up by EMAIL instead — something a
-- human reliably gets right by reading it off the same "Add User" screen,
-- rather than by transcribing a 36-character UUID.
-- ============================================================================

create or replace function bootstrap_super_admin(p_email text, p_name text)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid;
  v_role_id uuid;
  v_row users;
begin
  -- Deliberately no role check here (unlike every other write RPC in this
  -- schema) — this is meant to be run from the Supabase SQL Editor, which
  -- already runs as the postgres superuser, before any application-level
  -- Super Admin exists to check against. It's a bootstrap tool, not part
  -- of the app's normal request path — nothing in the app calls it.
  select id into v_auth_id from auth.users where lower(email) = lower(p_email);
  if v_auth_id is null then
    raise exception 'AUTH_USER_NOT_FOUND: No Supabase Auth user with email %. Create it first: Authentication -> Users -> Add User, in the Supabase dashboard.', p_email;
  end if;

  if exists (select 1 from users where auth_user_id = v_auth_id) then
    raise exception 'ALREADY_LINKED: % is already linked to a users row. If they still can''t log in, the problem is something else -- check their row''s role_id and status directly.', p_email;
  end if;

  select id into v_role_id from roles where name = 'Super Admin';

  insert into users (name, email, role_id, auth_user_id, status)
    values (p_name, p_email, v_role_id, v_auth_id, 'active')
    returning * into v_row;

  return v_row;
end;
$$;

-- No grant to `authenticated` — this is meant to be called from the SQL
-- Editor (running as postgres) once, manually, not from the app.
