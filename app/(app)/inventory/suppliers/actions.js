"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function readFields(formData) {
  return {
    name: formData.get("name")?.toString().trim(),
    phone: formData.get("phone")?.toString().trim() || null,
    address: formData.get("address")?.toString().trim() || null,
  };
}

export async function createSupplier(formData) {
  const supabase = await createClient();
  const payload = readFields(formData);
  if (!payload.name) return { error: "Supplier name is required." };

  const { error } = await supabase.from("inventory_suppliers").insert(payload);
  if (error) return { error: error.message };
  revalidatePath("/inventory/suppliers");
  revalidatePath("/inventory/purchases");
  return { success: true };
}

export async function updateSupplier(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const payload = readFields(formData);
  if (!id) return { error: "Missing supplier." };
  if (!payload.name) return { error: "Supplier name is required." };

  const { error } = await supabase.from("inventory_suppliers").update(payload).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/suppliers");
  revalidatePath("/inventory/purchases");
  return { success: true };
}

export async function toggleSupplierStatus(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_suppliers").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/suppliers");
  revalidatePath("/inventory/purchases");
  return { success: true };
}

// inventory_purchases.supplier_id has no "on delete" clause (defaults to
// RESTRICT) — a supplier with purchase history literally can't be deleted
// at the database level; deactivate it instead.
export async function deleteSupplier(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_suppliers").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { error: "This supplier has purchase history and can't be deleted — deactivate it instead." };
    return { error: error.message };
  }
  revalidatePath("/inventory/suppliers");
  revalidatePath("/inventory/purchases");
  return { success: true };
}
