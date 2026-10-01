do $$ begin
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

grant anon, authenticated, service_role to msa_test;

-- Real Supabase projects grant broad table/sequence/function privileges to
-- anon/authenticated/service_role automatically at the platform level —
-- RLS (not these grants) is the actual gate. Without this, every write
-- fails with a flat "permission denied for table X" regardless of RLS,
-- which would make every RLS-dependent test in this suite meaningless (a
-- denial for the wrong reason looks identical to a correct one unless you
-- read the error text closely). Re-run after every new migration adds a
-- table — ALTER DEFAULT PRIVILEGES only covers what's created after it's
-- set, so this is re-granted broadly here rather than relying on that.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

-- storage.foldername() — a real Supabase Storage helper (splits a storage
-- object's path into folder segments), used by RLS policies on
-- storage.objects for per-folder access control. Standard reference
-- implementation, not something this app's migrations define themselves.
create or replace function storage.foldername(name text) returns text[] as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$ language plpgsql immutable;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
