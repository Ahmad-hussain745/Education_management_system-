-- ============================================================================
-- 19. RECEIPT NUMBERS
-- ============================================================================
-- One immutable, sequential, human-readable number per fee payment, assigned
-- by the database (not the app) so two cashiers saving at the same instant
-- can never collide, and a number is never reused. Format: RCP-YYYY-000001,
-- year taken from paid_on so a receipt printed for a backdated payment still
-- reads sensibly.

alter table fee_payments add column if not exists receipt_no text;
create sequence if not exists fee_payment_receipt_seq;

-- SECURITY DEFINER: without this, a real Cashier/Accountant session (which
-- has no direct GRANT on fee_payment_receipt_seq) gets "permission denied
-- for sequence" on every single payment — this is the exact same class of
-- bug already fixed for post_transaction() and the paid_total sync triggers
-- (section 12), just missed here. Confirmed by testing as the actual
-- `authenticated` role rather than as the Postgres superuser, which
-- silently bypasses this kind of privilege check.
create or replace function assign_receipt_no() returns trigger as $$
begin
  if new.receipt_no is null then
    new.receipt_no := 'RCP-' || to_char(new.paid_on, 'YYYY') || '-' || lpad(nextval('fee_payment_receipt_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_fee_payments_receipt_no on fee_payments;
create trigger trg_fee_payments_receipt_no
  before insert on fee_payments
  for each row execute function assign_receipt_no();

create unique index if not exists uq_fee_payments_receipt_no on fee_payments(receipt_no) where receipt_no is not null;

-- Backfill any payments that predate this migration, in the order they were
-- actually paid, so receipt numbers still read as a sensible timeline.
do $$
declare r record;
begin
  for r in select id, paid_on from fee_payments where receipt_no is null order by paid_on, created_at loop
    update fee_payments
      set receipt_no = 'RCP-' || to_char(r.paid_on, 'YYYY') || '-' || lpad(nextval('fee_payment_receipt_seq')::text, 6, '0')
      where id = r.id;
  end loop;
end $$;
