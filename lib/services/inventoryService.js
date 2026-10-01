"use client";

import { inventoryRepository } from "@/lib/repositories/inventoryRepository";

export const inventoryService = {
  async recordMovement(supabase, { instituteId, itemId, movementType, quantity, reason, movementDate }) {
    if (!itemId) throw new Error("Select an item.");
    if (!["stock_in", "stock_out"].includes(movementType)) throw new Error("Invalid movement type.");
    if (!quantity || Number(quantity) <= 0) throw new Error("Enter a quantity greater than 0.");
    if (!reason?.trim()) throw new Error("A reason is required.");

    return inventoryRepository.recordMovement(supabase, {
      instituteId, itemId, movementType, quantity: Number(quantity), reason: reason.trim(), movementDate,
    });
  },

  async recordPurchase(supabase, { instituteId, itemId, supplierId, quantity, unitPrice, purchaseDate, method }) {
    if (!itemId) throw new Error("Select an item.");
    if (!quantity || Number(quantity) <= 0) throw new Error("Enter a quantity greater than 0.");
    if (unitPrice === "" || unitPrice === null || Number(unitPrice) < 0) throw new Error("Enter a unit price of 0 or more.");

    return inventoryRepository.recordPurchase(supabase, {
      instituteId, itemId, supplierId: supplierId || null,
      quantity: Number(quantity), unitPrice: Number(unitPrice),
      purchaseDate, method: method || "Cash",
    });
  },

  async getRecent({ instituteId, itemId }) {
    return inventoryRepository.getRecent({ instituteId, itemId });
  },

  async getPending({ instituteId }) {
    return inventoryRepository.getPending({ instituteId });
  },

  async projectStock({ instituteId, itemId, serverStock }) {
    return inventoryRepository.projectStock({ instituteId, itemId, serverStock });
  },
};
