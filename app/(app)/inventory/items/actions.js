"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function readFields(formData) {
  return {
    name: formData.get("name")?.toString().trim(),
    category_id: formData.get("category_id")?.toString() || null,
    unit: formData.get("unit")?.toString().trim() || "pcs",
    opening_stock: Number(formData.get("opening_stock") || 0),
    reorder_level: formData.get("reorder_level")?.toString().trim()
      ? Number(formData.get("reorder_level"))
      : null,
  };
}

export async function createItem(formData) {
  const supabase = await createClient();
  const payload = readFields(formData);
  if (!payload.name) return { error: "Item name is required." };
  if (payload.opening_stock < 0) return { error: "Opening stock can't be negative." };

  const { error } = await supabase.from("inventory_items").insert(payload);
  if (error) return { error: error.message };
  revalidatePath("/inventory/items");
  revalidatePath("/inventory/purchases");
  revalidatePath("/inventory/stock-in");
  revalidatePath("/inventory/stock-out");
  return { success: true };
}

// Note: opening_stock is a single baseline, not date-stamped — editing it
// later shifts every "Opening" figure the Stock Report has ever computed
// for periods before today, retroactively. Fine for correcting a mistake
// entered when the item was first set up; not meant as a running "reset"
// button once purchases/movements exist against the item.
export async function updateItem(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const payload = readFields(formData);
  if (!id) return { error: "Missing item." };
  if (!payload.name) return { error: "Item name is required." };
  if (payload.opening_stock < 0) return { error: "Opening stock can't be negative." };

  const { error } = await supabase.from("inventory_items").update(payload).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/items");
  revalidatePath("/inventory/purchases");
  revalidatePath("/inventory/stock-in");
  revalidatePath("/inventory/stock-out");
  return { success: true };
}

export async function toggleItemStatus(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/items");
  return { success: true };
}

// inventory_purchases.item_id and inventory_stock_movements.item_id both
// reference this table with the default RESTRICT — an item with any
// purchase or movement history can't be deleted, only deactivated.
export async function deleteItem(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { error: "This item has purchase/stock history and can't be deleted — deactivate it instead." };
    return { error: error.message };
  }
  revalidatePath("/inventory/items");
  return { success: true };
}
