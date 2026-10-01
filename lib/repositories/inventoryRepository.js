"use client";

import { getConnectivity } from "@/lib/offline/connectivity";
import * as offlineInventory from "@/lib/offline/repositories/inventory";

// There's no "use server" action for stock movements — StockMovementForm
// has always called supabase.rpc() directly from the client, so the online
// branch does the same rather than inventing a server action that didn't
// exist. `supabase` is the browser client the calling component already has.
export const inventoryRepository = {
  async recordMovement(supabase, { instituteId, itemId, movementType, quantity, reason, movementDate }) {
    if (getConnectivity()) {
      try {
        const { error } = await supabase.rpc("record_stock_movement", {
          p_item_id: itemId, p_movement_type: movementType, p_quantity: quantity, p_reason: reason, p_movement_date: movementDate,
        });
        if (error) throw error;
        return { mode: "online" };
      } catch (err) {
        // INSUFFICIENT_STOCK (and the other named guards) are the server
        // correctly refusing this movement, not a connectivity problem.
        // Queuing them offline would just recreate the same refusal at
        // sync time — hours later, without the person who could fix it
        // standing there. Surface it now.
        if (isBusinessRule(err.message)) throw err;
        return await this._queueOffline({ instituteId, itemId, movementType, quantity, reason, movementDate });
      }
    }
    return await this._queueOffline({ instituteId, itemId, movementType, quantity, reason, movementDate });
  },

  async recordPurchase(supabase, { instituteId, itemId, supplierId, quantity, unitPrice, purchaseDate, method }) {
    if (getConnectivity()) {
      try {
        const { error } = await supabase.rpc("record_inventory_purchase", {
          p_item_id: itemId, p_supplier_id: supplierId, p_quantity: quantity,
          p_unit_price: unitPrice, p_purchase_date: purchaseDate, p_method: method,
        });
        if (error) throw error;
        return { mode: "online" };
      } catch (err) {
        // A purchase backdated into a closed accounting month is rejected
        // by the same month-closed guard as any expense (0019) — that's a
        // real refusal, not a network failure.
        if (isBusinessRule(err.message)) throw err;
        return await this._queueOffline({
          instituteId, itemId, movementType: "purchase", quantity,
          movementDate: purchaseDate, supplierId, unitPrice, method,
        });
      }
    }
    return await this._queueOffline({
      instituteId, itemId, movementType: "purchase", quantity,
      movementDate: purchaseDate, supplierId, unitPrice, method,
    });
  },

  async _queueOffline(args) {
    const record = await offlineInventory.queueStockMovement(args);
    return { mode: "offline", record };
  },

  async getRecent({ instituteId, itemId }) {
    return offlineInventory.getRecentMovements(instituteId, itemId);
  },

  async getPending({ instituteId }) {
    return offlineInventory.getPendingMovements(instituteId);
  },

  async projectStock({ instituteId, itemId, serverStock }) {
    return offlineInventory.projectStockForItem(instituteId, itemId, serverStock);
  },
};

function isBusinessRule(message) {
  return /INSUFFICIENT_STOCK|NOT_AUTHORIZED|INVALID_ITEM|INVALID_QUANTITY|INVALID_PRICE|REASON_REQUIRED|USE_PURCHASE_FLOW|MONTH_CLOSED|closed/i.test(message || "");
}
