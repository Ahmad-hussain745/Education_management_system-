-- ============================================================================
-- 46. PER-INSTITUTE AUTOMATION CONTROLS
--
-- automation_jobs.enabled (0045) is deliberately GLOBAL — "a job is a piece
-- of code," per that migration's own comment. That's correct for the
-- registry, but Phase 14's Automation Center puts a Pause/Resume button in
-- front of a Super Admin who only administers ONE institute. Wiring that
-- button straight to automation_jobs.enabled would mean one school pausing
-- Fee Reminders silently pauses it for every other school on the platform
-- — the same class of cross-tenant bug 0035_multi_tenancy.sql exists to
-- prevent everywhere else.
--
-- Fix: an override table, checked first, falling back to the global
-- default when an institute has never touched it. This is additive only —
-- automation_jobs and the existing global-gate behavior are unchanged for
-- any caller that doesn't pass an institute (there are none left after
-- this migration; see engine.js).
-- ============================================================================

create table if not exists automation_job_overrides (
  institute_id uuid not null references institutes(id) on delete cascade,
  job_key      text not null references automation_jobs(key) on update cascade,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  primary key (institute_id, job_key)
);

alter table automation_job_overrides enable row level security;

create policy "read own institute overrides" on automation_job_overrides
  for select using (institute_id = current_institute_id());

-- No insert/update/delete policy for authenticated users — writes only
-- through set_automation_job_enabled() below, which is where the "must be
-- Super Admin of THIS institute" check actually lives. Same shape as every
-- other trusted-gateway function in this codebase (README's "Recent
-- security hardening" section): a SECURITY DEFINER function checks its own
-- authorization rather than trusting RLS or a hidden UI button, because it
-- bypasses RLS entirely once it's DEFINER.
create or replace function set_automation_job_enabled(p_job_key text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_institute_id uuid := current_institute_id();
  v_user_id      uuid;
begin
  if not (current_role_name() = 'Super Admin') then
    raise exception 'NOT_AUTHORIZED: Only a Super Admin can pause or resume automation.';
  end if;
  if v_institute_id is null then
    raise exception 'NO_INSTITUTE: Not assigned to an institute.';
  end if;
  if not exists (select 1 from automation_jobs where key = p_job_key) then
    raise exception 'UNKNOWN_JOB: % is not a recognized automation job.', p_job_key;
  end if;

  select id into v_user_id from users where auth_user_id = auth.uid();

  insert into automation_job_overrides (institute_id, job_key, enabled, updated_by, updated_at)
    values (v_institute_id, p_job_key, p_enabled, v_user_id, now())
  on conflict (institute_id, job_key)
    do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke execute on function set_automation_job_enabled(text, boolean) from public;
grant execute on function set_automation_job_enabled(text, boolean) to authenticated;
