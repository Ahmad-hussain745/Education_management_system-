-- ============================================================================
-- 41. IDEMPOTENT OFFLINE SYNC
--
-- An idempotency_key column on the outbox alone doesn't prevent a
-- duplicate: if a sync request's INSERT succeeds server-side but the
-- response is lost (dropped connection, timeout) before the client sees
-- it, the client retries and inserts the SAME logical entry a second
-- time. Attendance already can't have this problem — its existing unique
-- constraint on (student_id, date, class_id, section_id, subject_id)
-- rejects the retry outright, which sync-engine.js already treats as
-- "already synced, discard the local duplicate" (see the 23505 handling
-- added in Phase 3).
--
-- Expenses and inventory stock movements have no natural unique key —
-- two genuinely different Rs. 500 utility payments on the same day are
-- both legitimate, so nothing about their own columns can distinguish
-- "this is a retry of the last one" from "this is a second, separate one."
-- That's exactly what idempotency_key is for: the CLIENT decides once,
-- generates one key per outbox entry, and a real unique constraint on the
-- server makes a retried insert with that same key a safe no-op instead
-- of a duplicate row.
-- ============================================================================

alter table expenses add column if not exists idempotency_key uuid unique;
alter table inventory_stock_movements add column if not exists idempotency_key uuid unique;

-- record_stock_movement() gains an optional idempotency key. When given
-- one, a retry that matches an existing row returns that row instead of
-- re-validating and re-inserting — deliberately checked BEFORE the
-- INSUFFICIENT_STOCK check, so a successful movement's retry can never be
-- rejected by stock having since changed (it already happened; re-running
-- the availability check on a retry would be checking the wrong thing).
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

revoke execute on function record_stock_movement(uuid, inventory_movement_type, numeric, text, date, uuid) from public;
grant execute on function record_stock_movement(uuid, inventory_movement_type, numeric, text, date, uuid) to authenticated;
