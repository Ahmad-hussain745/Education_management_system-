-- ============================================================================
-- 51. MULTI-INSTITUTE SECURITY AUDIT — findings and fixes
--
-- Every SECURITY DEFINER function in the codebase (66 as of 0050) was
-- reviewed against: does it read institute_id, does it validate the
-- current institute, can service_role bypass safely, can another
-- institute's data leak or be modified. Full method: an automated pass
-- flagged every SD function touching a tenant-scoped table with no
-- institute_id/current_institute_id() reference anywhere in its body (35
-- of 66); each was then read individually, since a trigger acting only on
-- NEW/OLD is safe by construction (it only ever touches the one row that
-- fired it) while a function taking an id parameter directly is the real
-- risk category. Two categories came back genuinely clean and are called
-- out below rather than silently passing: global_search() (Search) and
-- is_parent_of()/is_parent_of_class() (Parents).
--
-- SEVERE — cross-institute WRITE (one institute could modify another's
-- real financial or academic records):
--   • reverse_fee_payment / reverse_income / reverse_expense /
--     reverse_salary_payment — took p_id with a role check but no
--     ownership check. Any finance staff at ANY institute could reverse
--     ANY other institute's real transaction.
--   • compute_exam_results / publish_exam_results / unpublish_exam_results
--     — took p_exam_id with a role check but no ownership check.
--   • repair_fee_record — took p_student_id with no ownership check.
--   • record_stock_movement / record_inventory_purchase — the item lookup
--     had no institute check. This is MY OWN bug from Phase 12/13; fixing
--     it here rather than pretending it was someone else's.
--   • close_cashier_day / compute_cashier_closing_totals /
--     get_cashier_closing_summary — p_cashier_id had no institute check.
--
-- SEVERE — cross-institute DENIAL OF SERVICE:
--   • is_month_closed — no institute filter on monthly_closing, so ONE
--     institute closing a month blocked fee/expense/salary posting for
--     EVERY institute, for that same calendar month.
--
-- MODERATE — cross-institute READ leak:
--   • preview_monthly_fee_generation — counted/summed across ALL
--     institutes, shown directly in the Generate Fees UI.
--   • resolve_monthly_fee — returned another institute's fee amount for
--     an arbitrary student/class id.
--   • list_cashiers — listed every institute's cashiers by name.
--
-- CLEAN, no change — noted so this isn't mistaken for an oversight:
--   • global_search() is deliberately NOT security definer; it runs as
--     the caller, so every branch inherits RLS exactly as if queried
--     directly. Correct by construction.
--   • is_parent_of() / is_parent_of_class() query parent_students scoped
--     to auth.uid() = the calling parent's own identity — the WHERE
--     clause itself is the isolation, regardless of SD status.
--   • Pure self-lookup helpers (current_teacher_id, current_users_id,
--     is_active_user, is_active_staff, current_role_name) answer "who is
--     the caller," not "give me data about X" — nothing to leak.
--   • Trigger functions acting only on NEW/OLD (set_updated_at,
--     sync_fee_record_totals, sync_salary_record_paid,
--     block_ledger_row_delete, assign_receipt_no, log_audit, and others)
--     only ever touch the single row that fired them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reversals: add the ownership check every one of the four was missing.
-- ---------------------------------------------------------------------------
create or replace function reverse_fee_payment(p_id uuid, p_reason text) returns void as $$
declare
  v_row fee_payments%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse a fee payment.';
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

create or replace function reverse_income(p_id uuid, p_reason text) returns void as $$
declare
  v_row income%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse an income entry.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse an entry.';
  end if;

  select * into v_row from income where id = p_id;
  if v_row.id is null then raise exception 'Income entry not found.'; end if;
  if v_row.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That entry does not belong to your institute.';
  end if;
  if v_row.reversed_at is not null then raise exception 'This entry was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();
  update income set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;
  perform post_transaction('income', 'out', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'income', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function reverse_expense(p_id uuid, p_reason text) returns void as $$
declare
  v_row expenses%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse an expense.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse an entry.';
  end if;

  select * into v_row from expenses where id = p_id;
  if v_row.id is null then raise exception 'Expense not found.'; end if;
  if v_row.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That expense does not belong to your institute.';
  end if;
  if v_row.reversed_at is not null then raise exception 'This expense was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();
  update expenses set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;
  perform post_transaction('expense', 'in', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'expenses', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function reverse_salary_payment(p_id uuid, p_reason text) returns void as $$
declare
  v_row salary_payments%rowtype;
  v_user_id uuid;
begin
  if not is_finance_staff() then
    raise exception 'Only finance staff can reverse a salary payment.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a payment.';
  end if;

  select * into v_row from salary_payments where id = p_id;
  if v_row.id is null then raise exception 'Salary payment not found.'; end if;
  if v_row.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That payment does not belong to your institute.';
  end if;
  if v_row.reversed_at is not null then raise exception 'This payment was already reversed.'; end if;

  select id into v_user_id from users where auth_user_id = auth.uid();
  update salary_payments set reversed_at = now(), reversed_by = v_user_id, reversal_reason = p_reason where id = p_id;
  perform post_transaction('salary_payment', 'in', v_row.amount, v_row.method, current_date,
    'Reversal: ' || p_reason, 'salary_payments', v_row.id);
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Exams: verify the exam itself belongs to the caller's institute before
-- reading its marks or writing its results/publish state.
-- ---------------------------------------------------------------------------
create or replace function compute_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to calculate exam results.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and institute_id = current_institute_id()) then
    raise exception 'NOT_AUTHORIZED: That exam does not belong to your institute.';
  end if;

  with totals as (
    select
      em.student_id,
      s.class_id,
      sum(coalesce(em.marks_obtained, 0)) as total_marks,
      sum(es.max_marks) as total_max_marks
    from exam_marks em
    join exam_subjects es on es.id = em.exam_subject_id
    join students s on s.id = em.student_id
    where es.exam_id = p_exam_id
    group by em.student_id, s.class_id
  ),
  scored as (
    select t.*,
      case when t.total_max_marks > 0 then round(t.total_marks / t.total_max_marks * 100, 2) else 0 end as percentage
    from totals t
  ),
  graded as (
    select sc.*,
      (select gr.id from grade_rules gr
        where sc.percentage >= gr.min_percentage and sc.percentage <= gr.max_percentage
        order by gr.min_percentage desc limit 1) as grade_rule_id
    from scored sc
  ),
  ranked as (
    select g.*, dense_rank() over (partition by g.class_id order by g.percentage desc) as class_rank
    from graded g
  )
  insert into exam_results (exam_id, student_id, total_marks, total_max_marks, percentage, grade_rule_id, class_rank, status)
  select p_exam_id, student_id, total_marks, total_max_marks, percentage, grade_rule_id, class_rank, 'draft'
  from ranked
  on conflict (exam_id, student_id) do update set
    total_marks = excluded.total_marks,
    total_max_marks = excluded.total_max_marks,
    percentage = excluded.percentage,
    grade_rule_id = excluded.grade_rule_id,
    class_rank = excluded.class_rank,
    computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function publish_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_by uuid;
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to publish exam results.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and institute_id = current_institute_id()) then
    raise exception 'NOT_AUTHORIZED: That exam does not belong to your institute.';
  end if;
  select id into v_by from users where auth_user_id = auth.uid();
  update exam_results set status = 'published', published_at = now(), published_by = v_by
    where exam_id = p_exam_id and status = 'draft';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function unpublish_exam_results(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not can_approve() then
    raise exception 'NOT_AUTHORIZED: Not authorized to unpublish exam results.';
  end if;
  if not exists (select 1 from exams where id = p_exam_id and institute_id = current_institute_id()) then
    raise exception 'NOT_AUTHORIZED: That exam does not belong to your institute.';
  end if;
  update exam_results set status = 'draft', published_at = null, published_by = null
    where exam_id = p_exam_id and status = 'published';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fees: repair_fee_record needs the same ownership check
-- get_or_create_fee_record already has; the two preview/resolve functions
-- need their queries scoped so they can't answer for another institute.
-- ---------------------------------------------------------------------------
create or replace function repair_fee_record(p_student_id uuid, p_month date)
returns fee_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_month   date := date_trunc('month', p_month)::date;
  v_class_id uuid;
  v_student_inst uuid;
  v_row     fee_records;
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant') then
    raise exception 'NOT_AUTHORIZED: Not authorized to repair fee records.';
  end if;

  select class_id, institute_id into v_class_id, v_student_inst from students where id = p_student_id;
  if v_student_inst is null then
    raise exception 'INVALID_STUDENT: That student does not exist.';
  end if;
  if v_student_inst != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That student does not belong to your institute.';
  end if;

  update fee_records set
    monthly_fee = resolve_monthly_fee(p_student_id, v_class_id, v_month),
    previous_balance = previous_outstanding(p_student_id, v_month),
    discount = coalesce((select sum(amount) from fee_discounts where student_id = p_student_id and active and institute_id = current_institute_id()), 0)
  where student_id = p_student_id and month = v_month and paid_total = 0
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_REPAIRABLE: No fee_records row for that student/month with paid_total = 0 — either none exists yet, or it already has a payment against it and is intentionally left untouched.';
  end if;

  return v_row;
end;
$$;

create or replace function resolve_monthly_fee(p_student_id uuid, p_class_id uuid, p_month date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fee numeric(12,2);
begin
  select monthly_fee into v_fee
    from fee_structures
    where student_id = p_student_id and active and date_trunc('month', effective_from) <= p_month
      and institute_id = current_institute_id()
    order by effective_from desc limit 1;

  if v_fee is null then
    select monthly_fee into v_fee
      from fee_structures
      where class_id = p_class_id and student_id is null and active and date_trunc('month', effective_from) <= p_month
        and institute_id = current_institute_id()
      order by effective_from desc limit 1;
  end if;

  return coalesce(v_fee, 0);
end;
$$;

create or replace function preview_monthly_fee_generation(p_month date)
returns table(active_students int, already_generated int, to_generate int, expected_amount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_month date := date_trunc('month', p_month)::date;
  v_inst  uuid := current_institute_id();
begin
  select current_role_name() into v_role;
  if v_role is null or v_role not in ('Super Admin', 'Accountant', 'Cashier') then
    raise exception 'Not authorized to preview fee generation.';
  end if;

  return query
  select
    (select count(*) from students where status = 'active' and institute_id = v_inst)::int,
    (select count(*) from fee_records fr join students s on s.id = fr.student_id
       where fr.month = v_month and s.status = 'active' and s.institute_id = v_inst)::int,
    (select count(*) from students s where s.status = 'active' and s.institute_id = v_inst
       and not exists (select 1 from fee_records fr where fr.student_id = s.id and fr.month = v_month))::int,
    coalesce((
      select sum(
        resolve_monthly_fee(s.id, s.class_id, v_month)
        + previous_outstanding(s.id, v_month)
        - coalesce((select sum(amount) from fee_discounts where student_id = s.id and active and institute_id = v_inst), 0)
      )
      from students s
      where s.status = 'active' and s.institute_id = v_inst
        and not exists (select 1 from fee_records fr where fr.student_id = s.id and fr.month = v_month)
    ), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory: my own bug (Phase 12/13) — the item lookup in both functions
-- had no institute check, so a finance-staff user could act on another
-- institute's item by id.
-- ---------------------------------------------------------------------------
create or replace function record_stock_movement(
  p_item_id uuid,
  p_movement_type inventory_movement_type,
  p_quantity numeric,
  p_reason text,
  p_movement_date date default current_date,
  p_idempotency_key uuid default null
)
returns inventory_stock_movements
language plpgsql security definer set search_path = public as $$
declare
  v_item      inventory_items;
  v_by        uuid;
  v_available numeric;
  v_row       inventory_stock_movements;
begin
  if p_idempotency_key is not null then
    select * into v_row from inventory_stock_movements where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to adjust stock.';
  end if;
  if p_movement_type = 'purchase' then
    raise exception 'USE_PURCHASE_FLOW: Use the Purchases screen to record a purchase — it needs a supplier, unit price, and the linked expense.';
  end if;

  select * into v_item from inventory_items where id = p_item_id;
  if v_item is null or not v_item.active then
    raise exception 'INVALID_ITEM: That item does not exist or is inactive.';
  end if;
  if v_item.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That item does not belong to your institute.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY: Enter a quantity greater than 0.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED: A reason is required for a manual stock adjustment.';
  end if;

  if p_movement_type = 'stock_out' then
    v_available := get_item_stock(p_item_id, p_movement_date);
    if p_quantity > v_available then
      raise exception 'INSUFFICIENT_STOCK: Only % % of % available on % — cannot remove %.', v_available, v_item.unit, v_item.name, p_movement_date, p_quantity;
    end if;
  end if;

  select id into v_by from users where auth_user_id = auth.uid();

  insert into inventory_stock_movements (item_id, movement_type, quantity, reason, movement_date, created_by, idempotency_key)
    values (p_item_id, p_movement_type, p_quantity, trim(p_reason), p_movement_date, v_by, p_idempotency_key)
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function record_inventory_purchase(
  p_item_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_purchase_date date,
  p_method payment_method default 'Cash',
  p_idempotency_key uuid default null
)
returns inventory_purchases
language plpgsql security definer set search_path = public as $$
declare
  v_item        inventory_items;
  v_amount      numeric(12,2);
  v_expense_id  uuid;
  v_by          uuid;
  v_row         inventory_purchases;
begin
  if p_idempotency_key is not null then
    select * into v_row from inventory_purchases where idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;

  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to record purchases.';
  end if;

  select * into v_item from inventory_items where id = p_item_id;
  if v_item is null or not v_item.active then
    raise exception 'INVALID_ITEM: That item does not exist or is inactive.';
  end if;
  if v_item.institute_id != current_institute_id() then
    raise exception 'NOT_AUTHORIZED: That item does not belong to your institute.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY: Enter a quantity greater than 0.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'INVALID_PRICE: Enter a unit price of 0 or more.';
  end if;

  v_amount := p_quantity * p_unit_price;
  select id into v_by from users where auth_user_id = auth.uid();

  insert into expenses (category, description, amount, method, expense_date, paid_by, idempotency_key)
    values ('Inventory Purchase', v_item.name || ' × ' || p_quantity || ' ' || v_item.unit, v_amount, p_method, p_purchase_date, v_by, p_idempotency_key)
    returning id into v_expense_id;

  insert into inventory_purchases (item_id, supplier_id, quantity, unit_price, purchase_date, expense_id, created_by, idempotency_key)
    values (p_item_id, p_supplier_id, p_quantity, p_unit_price, p_purchase_date, v_expense_id, v_by, p_idempotency_key)
    returning * into v_row;

  insert into inventory_stock_movements (item_id, movement_type, quantity, purchase_id, movement_date, created_by, idempotency_key)
    values (p_item_id, 'purchase', p_quantity, v_row.id, p_purchase_date, v_by, p_idempotency_key);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashier closing: the target cashier must belong to the caller's
-- institute, whether the caller is the cashier themselves (already
-- implied — see below) or finance staff closing on someone else's behalf.
-- ---------------------------------------------------------------------------
create or replace function compute_cashier_closing_totals(p_cashier_id uuid, p_date date)
returns table (cash_collections numeric, bank_collections numeric, other_income_cash numeric, expected_cash numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = p_cashier_id and institute_id = current_institute_id()) then
    raise exception 'NOT_AUTHORIZED: That cashier does not belong to your institute.';
  end if;

  return query
  select
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method = 'Cash' and institute_id = current_institute_id()), 0),
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method <> 'Cash' and institute_id = current_institute_id()), 0),
    coalesce((select sum(amount) from income
      where received_by = p_cashier_id and income_date = p_date and method = 'Cash' and institute_id = current_institute_id()), 0),
    coalesce((select sum(amount) from fee_payments
      where received_by = p_cashier_id and paid_on = p_date and method = 'Cash' and institute_id = current_institute_id()), 0)
    + coalesce((select sum(amount) from income
      where received_by = p_cashier_id and income_date = p_date and method = 'Cash' and institute_id = current_institute_id()), 0);
end;
$$;

create or replace function close_cashier_day(p_cashier_id uuid, p_date date, p_actual_cash numeric, p_reason text default null)
returns cashier_closings
language plpgsql security definer set search_path = public as $$
declare
  v_totals record;
  v_diff numeric;
  v_closed_by uuid;
  v_row cashier_closings;
begin
  if not (is_finance_staff() or (current_role_name() = 'Cashier' and current_users_id() = p_cashier_id)) then
    raise exception 'NOT_AUTHORIZED: You can only close your own cashier day.';
  end if;
  -- compute_cashier_closing_totals() (above) independently re-checks that
  -- p_cashier_id belongs to this institute — not duplicated here, since a
  -- Cashier's own current_users_id() = p_cashier_id branch already
  -- guarantees it's their own account, and that call is about to happen
  -- regardless.

  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'INVALID_ACTUAL_CASH: Enter the actual cash counted (0 or more).';
  end if;

  select * into v_totals from compute_cashier_closing_totals(p_cashier_id, p_date);
  v_diff := p_actual_cash - v_totals.expected_cash;

  if v_diff <> 0 and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception 'REASON_REQUIRED: A reason is required when actual cash differs from expected.';
  end if;

  select id into v_closed_by from users where auth_user_id = auth.uid();

  insert into cashier_closings (cashier_id, closing_date, cash_collections, bank_collections, other_income_cash, expected_cash, actual_cash, difference, reason, closed_by)
    values (p_cashier_id, p_date, v_totals.cash_collections, v_totals.bank_collections, v_totals.other_income_cash, v_totals.expected_cash, p_actual_cash, v_diff, p_reason, v_closed_by)
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function list_cashiers()
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_finance() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select u.id, u.name from users u
    join roles r on r.id = u.role_id
    where r.name = 'Cashier' and u.status = 'active' and u.institute_id = current_institute_id()
    order by u.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- is_month_closed: the denial-of-service fix. Without this, one
-- institute closing a month blocked fee/expense/salary posting for every
-- OTHER institute for that same calendar month too.
-- ---------------------------------------------------------------------------
create or replace function is_month_closed(p_month date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from monthly_closing
    where month = date_trunc('month', p_month)::date
      and institute_id = current_institute_id()
  );
$$;
