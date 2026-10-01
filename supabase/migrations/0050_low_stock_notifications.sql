-- ============================================================================
-- 50. LOW STOCK NOTIFICATIONS
--
-- low_stock_items() (0045) already answers "which items are low, right
-- now" as a live check — the Dashboard badge in this migration's UI half
-- uses exactly that, so the badge is always current and self-heals the
-- moment an item is restocked, with nothing to go stale.
--
-- What was missing is the "Notification" step your Phase 19 diagram asks
-- for: a real record that the automated check found something, which a
-- staff member can see in one place and dismiss — as opposed to the
-- finding only existing inside one day's automation_runs.summary JSON,
-- which nobody browses day to day. notifications (0027) can't hold this:
-- student_id is NOT NULL there, and this isn't about a student.
-- staff_notifications is new and deliberately generic — low_stock today,
-- reusable for a reconciliation drift or a payroll draft, without another
-- migration per alert type.
--
-- Upserted, not inserted fresh every day: one open notification per
-- (institute, type, related item), refreshed in place while the condition
-- persists, so ten days of the same low A4 Paper stock is one row with an
-- updated timestamp, not ten. It naturally disappears from "open" the
-- moment someone marks it dismissed OR the item is restocked, closed by
-- close_resolved_low_stock_notifications() below, called by the job after
-- each run with the current set of still-low item ids.
-- ============================================================================

create table if not exists staff_notifications (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references institutes(id) on delete cascade,
  type          text not null,                 -- 'low_stock' today; generic for future alert types
  severity      text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title         text not null,
  message       text not null,
  related_table text,
  related_id    uuid,
  dismissed_at  timestamptz,
  dismissed_by  uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists idx_staff_notifications_open_dedupe
  on staff_notifications(institute_id, type, related_id)
  where dismissed_at is null;

create index if not exists idx_staff_notifications_institute
  on staff_notifications(institute_id, dismissed_at, created_at desc);

alter table staff_notifications enable row level security;

create policy "read own institute staff notifications" on staff_notifications
  for select using (institute_id = current_institute_id());

-- Dismissal is the one write a normal signed-in user needs; everything
-- else (creation, the upsert-in-place refresh) happens through
-- upsert_low_stock_notification() below, service-role only.
create policy "dismiss own institute staff notifications" on staff_notifications
  for update using (institute_id = current_institute_id())
  with check (institute_id = current_institute_id());

create or replace function upsert_low_stock_notification(
  p_institute_id uuid, p_item_id uuid, p_item_name text, p_unit text, p_remaining numeric, p_reorder_level numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into staff_notifications (institute_id, type, severity, title, message, related_table, related_id)
    values (
      p_institute_id, 'low_stock',
      case when p_remaining <= 0 then 'critical' else 'warning' end,
      p_item_name || ' is low on stock',
      p_item_name || ': ' || p_remaining || ' ' || p_unit || ' remaining (minimum ' || p_reorder_level || ')',
      'inventory_items', p_item_id
    )
  on conflict (institute_id, type, related_id) where dismissed_at is null
  do update set message = excluded.message, severity = excluded.severity, updated_at = now();
end;
$$;

revoke execute on function upsert_low_stock_notification(uuid, uuid, text, text, numeric, numeric) from public, authenticated;
grant execute on function upsert_low_stock_notification(uuid, uuid, text, text, numeric, numeric) to service_role;

-- Closes any still-open low_stock notification for an item that the
-- latest check no longer considers low (restocked, or reorder_level
-- raised/cleared) — called with the current set of low item_ids each run.
create or replace function close_resolved_low_stock_notifications(p_institute_id uuid, p_still_low_item_ids uuid[])
returns void
language sql security definer set search_path = public as $$
  update staff_notifications
    set dismissed_at = now()
    where institute_id = p_institute_id
      and type = 'low_stock'
      and dismissed_at is null
      and not (related_id = any(coalesce(p_still_low_item_ids, array[]::uuid[])));
$$;

revoke execute on function close_resolved_low_stock_notifications(uuid, uuid[]) from public, authenticated;
grant execute on function close_resolved_low_stock_notifications(uuid, uuid[]) to service_role;

create or replace function dismiss_staff_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
begin
  select id into v_by from users where auth_user_id = auth.uid();
  update staff_notifications
    set dismissed_at = now(), dismissed_by = v_by
    where id = p_id and institute_id = current_institute_id();
end;
$$;

revoke execute on function dismiss_staff_notification(uuid) from public;
grant execute on function dismiss_staff_notification(uuid) to authenticated;
