import { db } from "../db";
import { enqueue } from "../sync/outbox";

// CORE PRINCIPLE: this file queues MOVEMENTS, never a computed total.
// The outbox entry for "Stock In 50" says +50 — it never says "stock is
// now 140". The server replays each movement through
// record_stock_movement()/record_inventory_purchase(), so
// inventory_stock_movements keeps one row per real event and the audit
// trail survives intact. A device that synced a final number instead
// would silently erase whatever anyone else did in the meantime, and
// leave no record of what actually happened. projectStock() below
// computes 140 for DISPLAY only — that number is never sent anywhere.
//
// stock_out is the one movement that can be legitimately rejected at sync
// time: record_stock_movement() checks quantity against LIVE stock, so if
// two people offline both queue "take the last 3 units," one gets
// INSUFFICIENT_STOCK. sync-engine.js routes that to sync_conflicts for a
// human rather than silently dropping or forcing it.
//
// purchase IS queueable (as of 0044_idempotent_purchases.sql). It was
// blocked previously, but a purchase only ever ADDS stock — there's no
// availability check that can fail at sync — and the expense + purchase +
// movement inserts all happen inside one atomic RPC, so it can't half-
// apply. The only hazard was duplication on retry, which the idempotency
// key now handles.

const VALID_TYPES = ["stock_in", "stock_out", "purchase"];

export async function queueStockMovement({
  instituteId, itemId, movementType, quantity, reason, movementDate,
  supplierId = null, unitPrice = null, method = "Cash",
}) {
  if (!VALID_TYPES.includes(movementType)) {
    throw new Error(`Unknown movement type: ${movementType}`);
  }

  const localId = crypto.randomUUID();
  const record = {
    local_id: localId,
    institute_id: instituteId,
    item_id: itemId,
    movement_type: movementType,
    quantity,
    reason: reason || (movementType === "purchase" ? "Purchase" : null),
    movement_date: movementDate,
    supplier_id: supplierId,
    unit_price: unitPrice,
    method,
    synced: false,
    created_at: new Date().toISOString(),
  };
  await db.inventory.put(record);

  // Two different RPCs, so two different payload shapes — the entity name
  // on the outbox entry is what tells sync-engine.js which to call.
  const payload =
    movementType === "purchase"
      ? {
          p_item_id: itemId,
          p_supplier_id: supplierId,
          p_quantity: quantity,
          p_unit_price: unitPrice,
          p_purchase_date: movementDate,
          p_method: method,
        }
      : {
          p_item_id: itemId,
          p_movement_type: movementType,
          p_quantity: quantity,
          p_reason: reason,
          p_movement_date: movementDate,
        };

  const { idempotencyKey } = await enqueue({
    entity: movementType === "purchase" ? "inventory_purchase" : "inventory",
    entityId: localId,
    payload,
  });
  await db.inventory.update(localId, { idempotency_key: idempotencyKey });
  return record;
}

export async function getRecentMovements(instituteId, itemId) {
  return db.inventory.where({ institute_id: instituteId, item_id: itemId }).reverse().sortBy("movement_date");
}

export async function getPendingMovements(instituteId) {
  const rows = await db.inventory.where({ institute_id: instituteId }).toArray();
  return rows.filter((r) => !r.synced);
}

// Display-only projection: the server's last-known stock for this item,
// plus every movement queued on THIS device that hasn't synced yet.
// Deliberately not persisted and never sent — see the note at the top of
// this file. It's also only as good as this one device's view: another
// cashier's offline movements aren't visible here, which is exactly why
// the server, not this function, remains the authority on stock.
export function projectStock(serverStock, pendingMovements) {
  return (pendingMovements || []).reduce((total, m) => {
    const qty = Number(m.quantity) || 0;
    if (m.movement_type === "stock_out") return total - qty;
    return total + qty; // stock_in and purchase both add
  }, Number(serverStock) || 0);
}

export async function projectStockForItem(instituteId, itemId, serverStock) {
  const rows = await db.inventory.where({ institute_id: instituteId, item_id: itemId }).toArray();
  return projectStock(serverStock, rows.filter((r) => !r.synced));
}

export async function markSynced(localId) {
  return db.inventory.update(localId, { synced: true });
}
