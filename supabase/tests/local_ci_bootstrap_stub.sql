-- Minimal local stand-in for what a real Supabase project already provides
-- (auth schema, storage schema, the anon/authenticated/service_role roles),
-- so this project's own migrations (0001..0060) can be applied and tested
-- against a real local Postgres without needing a live Supabase project.
-- Nothing here is part of the application's own migrations.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Tests impersonate a signed-in user the same way Supabase's real
-- auth.uid() resolves one — reading the `sub` claim of the request's JWT,
-- exposed to Postgres as the `request.jwt.claim.sub` session setting.
-- Realistically, a test sets this directly with
-- `select set_config('request.jwt.claim.sub', '<uuid>', true);` before
-- calling a function/query, rather than actually presenting a JWT — same
-- contract, no real login needed. This is deliberately the REAL
-- Supabase convention (not a project-specific stub), so anything using it
-- here behaves identically when run in the Supabase SQL Editor against an
-- actual project — see supabase/tests/role_boundary_test.sql.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Real Supabase Storage helper, used by path-scoped RLS policies (e.g.
-- this app's admission-documents bucket) — not part of this app's own
-- migrations, same category as auth.uid()/the anon/authenticated roles
-- above: platform infrastructure a real project provides, stubbed here
-- only so local/CI testing has it too.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- The baseline Supabase gives every project automatically as platform
-- infrastructure (not something an app's own migrations declare) — table-
-- level GRANT is the layer RLS narrows, not a replacement for it. Without
-- this, testing "as authenticated" from this stub would fail closed for
-- the wrong reason (no GRANT at all) rather than being genuinely
-- RLS-gated the way it is against a real project.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;

-- Tests that run "as a real user" need to do so as a role that isn't the
-- table owner/a superuser — RLS does not apply to either (Postgres
-- exempts them by default, absent FORCE ROW LEVEL SECURITY), which would
-- silently make an RLS-only check pass even if the policy were completely
-- broken. `SET ROLE authenticated;` before running such a test, `RESET
-- ROLE;` after — see role_boundary_test.sql and
-- reversal_and_tenant_isolation_test.sql's setup wrappers. NOLOGIN so it
-- still can't be connected to directly, only switched into from a
-- superuser session the way these test scripts do.
grant authenticated to postgres;

-- Supabase projects always have this publication pre-created for Realtime;
-- our own migrations (0058) only ever ADD tables to it, never create it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
