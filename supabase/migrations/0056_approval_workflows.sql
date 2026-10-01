-- ============================================================================
-- 56. APPROVAL WORKFLOWS — LARGE EXPENSES & FEE REVERSAL
--
-- Phase 26. "Stronger than normal CRUD permissions" means two things that
-- a role check alone can't give you:
--   1. A THIRD state between "not done" and "done" — pending — that
--      nothing else can skip past. Not just "only Accountant can create,
--      only Principal can approve" (that's still just two role checks),
--      but "the money/reversal literally cannot reach the ledger without
--      a second, different person's decision in between."
--   2. SEPARATION OF DUTIES — the same person can't satisfy both roles by
--      simply holding both permissions (Super Admin already can). Every
--      decide_*() function below checks requested_by <> the approver.
--
-- And critically: this has to be enforced in ONE place both the online
-- form and the offline sync queue actually go through, or it's not real
-- enforcement — an offline-recorded large expense would otherwise sync via
-- a raw insert and skip the whole workflow. See sync-engine.js's change in
-- this same phase: the "expenses" entity now calls request_expense()
-- instead of upserting the table directly, for exactly this reason.
-- ============================================================================

-- A per-institute figure, not a hardcoded constant — a small school and a
-- large one don't agree on what "large" means, and it needs to be
-- something an admin can actually change without a migration. Existing
-- installs get a conservative Rs. 10,000 default.
alter table institutes add column if not exists large_expense_threshold numeric(12,2) not null default 10000;

-- Name lookup for the approval UIs below (who requested/decided a given
-- expense or reversal request) — needed because users' own RLS ("read own
-- row" for anyone but Super Admin, 0002_rls.sql) means a plain embedded
-- `requested_by:users(name)` select would silently come back null for a
-- Principal or Accountant looking at someone else's request. Same fix
-- already applied for cashier names via list_cashiers() (0024); this is
-- the general form of it, for any can_view_finance() viewer looking at any
-- user in their own institute — not just cashiers.
create or replace function list_institute_users()
returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.name from users u
  where u.institute_id = current_institute_id() and can_view_finance();
$$;
revoke execute on function list_institute_users() from public;
grant execute on function list_institute_users() to authenticated;

-- ----------------------------------------------------------------------------
-- Large expenses: create → pending → Principal decides → THEN it posts.
-- Below the threshold, request_expense() posts immediately (unchanged
-- behavior) — this table only ever holds the "large" ones.
-- ----------------------------------------------------------------------------
create table if not exists expense_requests (
  id                   uuid primary key default gen_random_uuid(),
  institute_id         uuid references institutes(id) on delete cascade,
  category             text not null,
  description          text,
  amount               numeric(12,2) not null check (amount > 0),
  method               payment_method not null default 'Cash',
  expense_date         date not null default current_date,
  requested_by         uuid references users(id),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by           uuid references users(id),
  decided_at           timestamptz,
  decision_note        text,
  resulting_expense_id uuid references expenses(id),
  idempotency_key      uuid unique,
  created_at           timestamptz not null default now()
);
create index if not exists idx_expense_requests_institute on expense_requests(institute_id, status);

drop trigger if exists trg_set_institute_id on expense_requests;
create trigger trg_set_institute_id before insert on expense_requests
  for each row execute function set_institute_id();

alter table expense_requests enable row level security;
create policy institute_isolation on expense_requests as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

-- No client-side UPDATE policy anywhere on this table, on purpose — the
-- only way a row's status ever changes is decide_expense_request() below,
-- which is SECURITY DEFINER and so bypasses RLS for its own write. A
-- direct .update() call from the app, even by a Principal, has nothing to
-- match against and is simply denied.
create policy "finance staff view expense requests" on expense_requests for select using (can_view_finance());
create policy "finance staff create expense requests" on expense_requests for insert
  with check (is_finance_staff() and requested_by = (select id from users where auth_user_id = auth.uid()));

create or replace function request_expense(
  p_category text, p_description text, p_amount numeric, p_method text, p_expense_date date,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor     uuid;
  v_institute uuid;
  v_threshold numeric;
  v_existing_expense expenses%rowtype;
  v_existing_request expense_requests%rowtype;
  v_expense   expenses%rowtype;
  v_request   expense_requests%rowtype;
begin
  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to record an expense.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: Enter an amount greater than 0.';
  end if;
  if p_category is null or btrim(p_category) = '' then
    raise exception 'INVALID_CATEGORY: Category is required.';
  end if;

  -- Idempotency has to check BOTH tables a retry could have already
  -- landed in — a request whose response was lost might have posted
  -- straight to expenses (below threshold) or landed in expense_requests
  -- (at/above it); either way, the retry must return that same outcome,
  -- not create a second one.
  if p_idempotency_key is not null then
    select * into v_existing_expense from expenses where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('posted', true, 'expense_id', v_existing_expense.id);
    end if;
    select * into v_existing_request from expense_requests where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('posted', false, 'request_id', v_existing_request.id, 'status', v_existing_request.status);
    end if;
  end if;

  -- paid_by/requested_by is always resolved here from the session, never
  -- trusted as a parameter — same reasoning as createStudent()'s
  -- registeredBy and every other actor-attribution column in this app.
  select id into v_actor from users where auth_user_id = auth.uid();
  v_institute := current_institute_id();
  select large_expense_threshold into v_threshold from institutes where id = v_institute;
  v_threshold := coalesce(v_threshold, 10000);

  if p_amount < v_threshold then
    insert into expenses (category, description, amount, method, expense_date, paid_by, idempotency_key)
      values (btrim(p_category), p_description, p_amount, coalesce(p_method, 'Cash')::payment_method, coalesce(p_expense_date, current_date), v_actor, p_idempotency_key)
      returning * into v_expense;
    return jsonb_build_object('posted', true, 'expense_id', v_expense.id);
  else
    insert into expense_requests (category, description, amount, method, expense_date, requested_by, idempotency_key)
      values (btrim(p_category), p_description, p_amount, coalesce(p_method, 'Cash')::payment_method, coalesce(p_expense_date, current_date), v_actor, p_idempotency_key)
      returning * into v_request;
    return jsonb_build_object('posted', false, 'request_id', v_request.id, 'status', 'pending', 'threshold', v_threshold);
  end if;
end;
$$;
revoke execute on function request_expense(text, text, numeric, text, date, uuid) from public;
grant execute on function request_expense(text, text, numeric, text, date, uuid) to authenticated;

create or replace function decide_expense_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_req      expense_requests%rowtype;
  v_approver uuid;
  v_expense  expenses%rowtype;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin or Principal can decide an expense request.';
  end if;

  select * into v_req from expense_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That request does not belong to your institute.';
  end if;
  if v_req.status != 'pending' then
    raise exception 'ALREADY_DECIDED: This request was already %.', v_req.status;
  end if;

  select id into v_approver from users where auth_user_id = auth.uid();
  if v_approver = v_req.requested_by then
    raise exception 'NOT_AUTHORIZED: The person who requested this expense can''t also approve it — ask another Super Admin or the Principal.';
  end if;

  if p_approve then
    insert into expenses (category, description, amount, method, expense_date, paid_by, idempotency_key)
      values (v_req.category, v_req.description, v_req.amount, v_req.method, v_req.expense_date, v_req.requested_by, v_req.idempotency_key)
      returning * into v_expense;
    update expense_requests
      set status = 'approved', decided_by = v_approver, decided_at = now(), decision_note = p_note, resulting_expense_id = v_expense.id
      where id = p_request_id;
    return jsonb_build_object('posted', true, 'expense_id', v_expense.id);
  else
    if p_note is null or btrim(p_note) = '' then
      raise exception 'REASON_REQUIRED: A reason is required to reject a request.';
    end if;
    update expense_requests set status = 'rejected', decided_by = v_approver, decided_at = now(), decision_note = p_note
      where id = p_request_id;
    return jsonb_build_object('posted', false, 'status', 'rejected');
  end if;
end;
$$;
revoke execute on function decide_expense_request(uuid, boolean, text) from public;
grant execute on function decide_expense_request(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Fee reversal: request → Principal authorizes → THEN the actual reversal
-- runs. Unlike expenses, this has no threshold — every fee reversal now
-- goes through this, because reverse_fee_payment() itself (below) no
-- longer accepts a direct call from `authenticated` at all.
-- ----------------------------------------------------------------------------
create table if not exists fee_reversal_requests (
  id              uuid primary key default gen_random_uuid(),
  institute_id    uuid references institutes(id) on delete cascade,
  fee_payment_id  uuid not null references fee_payments(id),
  reason          text not null,
  requested_by    uuid references users(id),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
-- One open request per payment at a time — a second request for the same
-- payment while one is already pending is a mistake to catch here, not
-- something to let two people accidentally race on.
create unique index if not exists idx_fee_reversal_one_pending on fee_reversal_requests(fee_payment_id) where status = 'pending';
create index if not exists idx_fee_reversal_requests_institute on fee_reversal_requests(institute_id, status);

drop trigger if exists trg_set_institute_id on fee_reversal_requests;
create trigger trg_set_institute_id before insert on fee_reversal_requests
  for each row execute function set_institute_id();

alter table fee_reversal_requests enable row level security;
create policy institute_isolation on fee_reversal_requests as restrictive for all
  using (institute_id = current_institute_id()) with check (institute_id = current_institute_id());

create policy "finance staff view fee reversal requests" on fee_reversal_requests for select using (can_view_finance());
create policy "finance staff create fee reversal requests" on fee_reversal_requests for insert
  with check (is_finance_staff() and requested_by = (select id from users where auth_user_id = auth.uid()));

create or replace function request_fee_reversal(p_fee_payment_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_payment fee_payments%rowtype;
  v_actor   uuid;
  v_req_id  uuid;
begin
  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to request a fee reversal.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: A reason is required to request a reversal.';
  end if;

  select * into v_payment from fee_payments where id = p_fee_payment_id;
  if v_payment.id is null then raise exception 'Payment not found.'; end if;
  if v_payment.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That payment does not belong to your institute.';
  end if;
  if v_payment.reversed_at is not null then
    raise exception 'ALREADY_REVERSED: This payment was already reversed.';
  end if;
  if exists (select 1 from fee_reversal_requests where fee_payment_id = p_fee_payment_id and status = 'pending') then
    raise exception 'ALREADY_PENDING: A reversal request for this payment is already awaiting authorization.';
  end if;

  select id into v_actor from users where auth_user_id = auth.uid();
  insert into fee_reversal_requests (fee_payment_id, reason, requested_by)
    values (p_fee_payment_id, p_reason, v_actor)
    returning id into v_req_id;
  return v_req_id;
end;
$$;
revoke execute on function request_fee_reversal(uuid, text) from public;
grant execute on function request_fee_reversal(uuid, text) to authenticated;

-- reverse_fee_payment() (0011, last touched by 0051) is now an internal
-- step only — no longer directly callable by finance staff, only reachable
-- through decide_fee_reversal() below. Its own role check widens to
-- "finance staff OR an approver" because current_role_name() reads the
-- ORIGINAL caller's session regardless of nesting (security definer
-- changes the effective privilege-checking role, not auth.uid()) — a
-- Principal calling in through decide_fee_reversal() is still, correctly,
-- seen as a Principal here, not finance staff.
create or replace function reverse_fee_payment(p_id uuid, p_reason text) returns void as $$
declare
  v_row fee_payments%rowtype;
  v_user_id uuid;
begin
  if not (is_finance_staff() or can_approve()) then
    raise exception 'Only finance staff or an approver can reverse a fee payment.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a payment.';
  end if;

  select * into v_row from fee_payments where id = p_id;
  if v_row.id is null then raise exception 'Payment not found.'; end if;
  if v_row.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That payment does not belong to your institute.';
  end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();
  update fee_payments set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;
  perform post_transaction('fee_payment', 'out', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'fee_payments', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

-- Direct call revoked — the ONLY path to this function now is from inside
-- decide_fee_reversal() below (which, being security definer itself, can
-- still call it regardless of this revoke; see e.g.
-- _draft_payroll_for_institute for the same pattern).
revoke execute on function reverse_fee_payment(uuid, text) from public, authenticated;

create or replace function decide_fee_reversal(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req      fee_reversal_requests%rowtype;
  v_approver uuid;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Only Super Admin or Principal can authorize a fee reversal.';
  end if;

  select * into v_req from fee_reversal_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That request does not belong to your institute.';
  end if;
  if v_req.status != 'pending' then
    raise exception 'ALREADY_DECIDED: This request was already %.', v_req.status;
  end if;

  select id into v_approver from users where auth_user_id = auth.uid();
  if v_approver = v_req.requested_by then
    raise exception 'NOT_AUTHORIZED: The person who requested this reversal can''t also authorize it — ask another Super Admin or the Principal.';
  end if;

  if p_approve then
    perform reverse_fee_payment(v_req.fee_payment_id, v_req.reason);
    update fee_reversal_requests set status = 'approved', decided_by = v_approver, decided_at = now(), decision_note = p_note
      where id = p_request_id;
  else
    if p_note is null or btrim(p_note) = '' then
      raise exception 'REASON_REQUIRED: A reason is required to deny a reversal request.';
    end if;
    update fee_reversal_requests set status = 'rejected', decided_by = v_approver, decided_at = now(), decision_note = p_note
      where id = p_request_id;
  end if;
end;
$$;
revoke execute on function decide_fee_reversal(uuid, boolean, text) from public;
grant execute on function decide_fee_reversal(uuid, boolean, text) to authenticated;
