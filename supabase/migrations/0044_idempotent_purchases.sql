-- ============================================================================
-- 44. IDEMPOTENT INVENTORY PURCHASES
--
-- 0041_idempotent_sync.sql gave expenses and inventory_stock_movements an
-- idempotency_key so an offline-queued entry whose response got lost can
-- be retried without duplicating. record_inventory_purchase() was left
-- out of that pass because purchases weren't queueable offline at the
-- time — the offline repository rejected movement_type='purchase'
-- outright.
--
-- Revisiting that: a purchase is actually SAFER to queue than a manual
-- stock_out, not riskier. record_inventory_purchase() does the expense
-- insert and the stock insert in ONE transaction, and a purchase only
-- ever ADDS stock, so there's no availability check that could fail at
-- sync time the way stock_out's INSUFFICIENT_STOCK can. The only real
-- hazard was duplication on retry — which is exactly what an idempotency
-- key solves. Hence this migration.
--
-- The key is checked before any validation or insert, and the linked
-- expense row carries the same key (expenses.idempotency_key is already
-- unique as of 0041), so a retry can't create an orphan expense even if
-- it somehow got past the purchase check.
-- ============================================================================

alter table inventory_purchases add column if not exists idempotency_key uuid unique;

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

revoke execute on function record_inventory_purchase(uuid, uuid, numeric, numeric, date, payment_method, uuid) from public;
grant execute on function record_inventory_purchase(uuid, uuid, numeric, numeric, date, payment_method, uuid) to authenticated;
