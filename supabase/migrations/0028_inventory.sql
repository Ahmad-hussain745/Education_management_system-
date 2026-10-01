-- ============================================================================
-- 31. INVENTORY / PURCHASES
--
-- Items → Categories → Suppliers → Purchases → Stock In / Stock Out →
-- Stock Report, plus the one explicit ask: "Expenses can then be linked to
-- purchases." A Purchase is never just a stock-count change — it's real
-- money leaving the school, so record_inventory_purchase() below does both
-- in one transaction: inserts into `expenses` (which the existing
-- trg_expenses_ledger trigger, 0001_init.sql, already turns into a
-- transactions row and an account-balance change — nothing new needed
-- there) AND inserts the matching stock movement, with
-- inventory_purchases.expense_id pointing at the row that actually moved
-- money. Manual "Stock In"/"Stock Out" (donations, corrections, issuing
-- supplies to a classroom) never touch `expenses` at all — they're not a
-- financial event, just a count change.
--
-- Same access tier as Fee Structure/Salary Configuration: is_finance_staff()
-- (Super Admin, Accountant) manage everything; can_view_finance() adds
-- Principal as read-only oversight. Neither Cashier nor Teacher has a
-- stated stake in procurement, so neither gets a policy here at all.
--
-- Known limitation, deliberately not solved here: reversing the linked
-- expense (Expenses page → Reverse, 0011_immutable_ledger.sql) does NOT
-- cascade into inventory_purchases/inventory_stock_movements — the money
-- and the stock count would go out of sync. Purchases/movements are
-- therefore treated as fully immutable (no reverse path offered on the
-- Inventory pages at all); correcting a bad purchase means a manual Stock
-- Out adjustment (with a reason) for the quantity, and reversing the
-- expense separately if the money side needs correcting too.
-- ============================================================================

create table inventory_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table inventory_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  address    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table inventory_items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category_id    uuid references inventory_categories(id) on delete set null,
  unit           text not null default 'pcs',   -- "packs", "boxes", "reams", "liters"...
  opening_stock  numeric(12,2) not null default 0 check (opening_stock >= 0),
  reorder_level  numeric(12,2),                  -- optional low-stock threshold, null = not tracked
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index idx_inventory_items_category on inventory_items(category_id);

create type inventory_movement_type as enum ('purchase', 'stock_in', 'stock_out');

-- One row per purchase transaction. total_amount is generated so the
-- expense amount and the purchase's own total can never drift apart —
-- record_inventory_purchase() computes the same figure once and uses it
-- for both inserts.
create table inventory_purchases (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references inventory_items(id),
  supplier_id   uuid references inventory_suppliers(id),
  quantity      numeric(12,2) not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  total_amount  numeric(12,2) generated always as (quantity * unit_price) stored,
  purchase_date date not null default current_date,
  expense_id    uuid references expenses(id),
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
create index idx_inventory_purchases_item on inventory_purchases(item_id);
create index idx_inventory_purchases_date on inventory_purchases(purchase_date);

-- The actual stock ledger — every purchase, every manual stock-in, every
-- stock-out is one row here. quantity is always positive; movement_type
-- says which direction it moves the count. Stock Report (below) sums this
-- table, never a cached "current stock" column, for the same reason
-- fee_records.paid_total is kept in sync from fee_payments rather than
-- trusted as its own source of truth.
create table inventory_stock_movements (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references inventory_items(id),
  movement_type  inventory_movement_type not null,
  quantity       numeric(12,2) not null check (quantity > 0),
  reason         text,                                    -- required for stock_in/stock_out, see the RPC below
  purchase_id    uuid references inventory_purchases(id),  -- set only when movement_type = 'purchase'
  movement_date  date not null default current_date,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now()
);
create index idx_inventory_movements_item_date on inventory_stock_movements(item_id, movement_date);

alter table inventory_categories       enable row level security;
alter table inventory_suppliers        enable row level security;
alter table inventory_items            enable row level security;
alter table inventory_purchases        enable row level security;
alter table inventory_stock_movements  enable row level security;

create policy "finance staff manage inventory categories" on inventory_categories for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views inventory categories" on inventory_categories for select using (can_view_finance());

create policy "finance staff manage inventory suppliers" on inventory_suppliers for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views inventory suppliers" on inventory_suppliers for select using (can_view_finance());

create policy "finance staff manage inventory items" on inventory_items for all
  using (is_finance_staff()) with check (is_finance_staff());
create policy "principal views inventory items" on inventory_items for select using (can_view_finance());

create policy "finance staff read inventory purchases" on inventory_purchases for select using (can_view_finance());
-- No insert/update/delete policy: every purchase is written only by
-- record_inventory_purchase() below (SECURITY DEFINER) so it can never be
-- entered without the matching expense — see the module comment above.

create policy "finance staff read inventory movements" on inventory_stock_movements for select using (can_view_finance());
-- Same shape: writes only through record_inventory_purchase() (movement_type
-- = 'purchase') or record_stock_movement() (stock_in/stock_out) below.

-- ----------------------------------------------------------------------------
-- Current stock on hand for one item, as of a date (defaults to today) —
-- opening_stock plus every movement up to and including that date. Shared
-- by the stock-out guard below and by the Items list ("live remaining").
-- ----------------------------------------------------------------------------
create or replace function get_item_stock(p_item_id uuid, p_as_of date default current_date)
returns numeric
language sql stable set search_path = public as $$
  select coalesce((select opening_stock from inventory_items where id = p_item_id), 0)
    + coalesce((select sum(quantity) from inventory_stock_movements
        where item_id = p_item_id and movement_type in ('purchase', 'stock_in') and movement_date <= p_as_of), 0)
    - coalesce((select sum(quantity) from inventory_stock_movements
        where item_id = p_item_id and movement_type = 'stock_out' and movement_date <= p_as_of), 0);
$$;

grant execute on function get_item_stock(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- Record a purchase: expense + purchase + stock-in movement, atomically.
-- Recomputes total_amount itself (quantity * unit_price) rather than
-- trusting a client-supplied total — same "never trust the client's
-- numbers" stance as close_cashier_day()/check_fee_payment_within_remaining.
-- ----------------------------------------------------------------------------
create or replace function record_inventory_purchase(
  p_item_id uuid,
  p_supplier_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_purchase_date date,
  p_method payment_method default 'Cash'
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
  if not is_finance_staff() then
    raise exception 'NOT_AUTHORIZED: Not authorized to record purchases.';
  end if;

  select * into v_item from inventory_items where id = p_item_id;
  if v_item is null or not v_item.active then
    raise exception 'INVALID_ITEM: That item does not exist or is inactive.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY: Enter a quantity greater than 0.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'INVALID_PRICE: Enter a unit price of 0 or more.';
  end if;

  v_amount := p_quantity * p_unit_price;
  select id into v_by from users where auth_user_id = auth.uid();

  -- trg_expenses_ledger (0001_init.sql) posts this to `transactions` and
  -- moves the account balance the moment this insert commits; the
  -- month-closed guard (0019) applies exactly as it would for a manual
  -- expense entry — a purchase backdated into a closed month is rejected
  -- the same way.
  insert into expenses (category, description, amount, method, expense_date, paid_by)
    values ('Inventory Purchase', v_item.name || ' × ' || p_quantity || ' ' || v_item.unit, v_amount, p_method, p_purchase_date, v_by)
    returning id into v_expense_id;

  insert into inventory_purchases (item_id, supplier_id, quantity, unit_price, purchase_date, expense_id, created_by)
    values (p_item_id, p_supplier_id, p_quantity, p_unit_price, p_purchase_date, v_expense_id, v_by)
    returning * into v_row;

  insert into inventory_stock_movements (item_id, movement_type, quantity, purchase_id, movement_date, created_by)
    values (p_item_id, 'purchase', p_quantity, v_row.id, p_purchase_date, v_by);

  return v_row;
end;
$$;

revoke execute on function record_inventory_purchase(uuid, uuid, numeric, numeric, date, payment_method) from public;
grant execute on function record_inventory_purchase(uuid, uuid, numeric, numeric, date, payment_method) to authenticated;

-- ----------------------------------------------------------------------------
-- Manual Stock In / Stock Out — no money involved, so no expense row.
-- Stock Out can't push an item negative: checked against get_item_stock()
-- as of the movement date, same "never let the number lie" reasoning as
-- check_fee_payment_within_remaining (a payment can't exceed what's owed).
-- ----------------------------------------------------------------------------
create or replace function record_stock_movement(
  p_item_id uuid,
  p_movement_type inventory_movement_type,
  p_quantity numeric,
  p_reason text,
  p_movement_date date default current_date
)
returns inventory_stock_movements
language plpgsql security definer set search_path = public as $$
declare
  v_item      inventory_items;
  v_by        uuid;
  v_available numeric;
  v_row       inventory_stock_movements;
begin
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

  insert into inventory_stock_movements (item_id, movement_type, quantity, reason, movement_date, created_by)
    values (p_item_id, p_movement_type, p_quantity, trim(p_reason), p_movement_date, v_by)
    returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function record_stock_movement(uuid, inventory_movement_type, numeric, text, date) from public;
grant execute on function record_stock_movement(uuid, inventory_movement_type, numeric, text, date) to authenticated;

-- ----------------------------------------------------------------------------
-- Stock Report — one row per active item for a date range: Opening (as of
-- the day before p_from) / Purchased (all stock-in movements — purchases
-- and manual stock-in combined — within the range) / Used (stock-out
-- within the range) / Remaining. No SECURITY DEFINER: this only aggregates
-- inventory_items/inventory_stock_movements, both already readable by
-- can_view_finance() via the policies above, so RLS on those tables
-- applies exactly as if the caller queried them directly — a Cashier or
-- Teacher calling this gets back nothing, not a privilege escalation.
-- ----------------------------------------------------------------------------
create or replace function inventory_stock_report(p_from date, p_to date)
returns table (
  item_id uuid, item_name text, unit text, category_name text,
  opening numeric, purchased numeric, used numeric, remaining numeric
)
language sql stable set search_path = public as $$
  with base as (
    select
      i.id as item_id, i.name as item_name, i.unit, c.name as category_name,
      i.opening_stock
        + coalesce((select sum(m.quantity) from inventory_stock_movements m
            where m.item_id = i.id and m.movement_type in ('purchase', 'stock_in') and m.movement_date < p_from), 0)
        - coalesce((select sum(m.quantity) from inventory_stock_movements m
            where m.item_id = i.id and m.movement_type = 'stock_out' and m.movement_date < p_from), 0) as opening,
      coalesce((select sum(m.quantity) from inventory_stock_movements m
          where m.item_id = i.id and m.movement_type in ('purchase', 'stock_in') and m.movement_date between p_from and p_to), 0) as purchased,
      coalesce((select sum(m.quantity) from inventory_stock_movements m
          where m.item_id = i.id and m.movement_type = 'stock_out' and m.movement_date between p_from and p_to), 0) as used
    from inventory_items i
    left join inventory_categories c on c.id = i.category_id
    where i.active
  )
  select item_id, item_name, unit, category_name, opening, purchased, used, (opening + purchased - used) as remaining
  from base
  order by item_name;
$$;

revoke execute on function inventory_stock_report(date, date) from public;
grant execute on function inventory_stock_report(date, date) to authenticated;
