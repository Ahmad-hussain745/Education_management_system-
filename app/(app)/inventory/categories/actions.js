"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createCategory(formData) {
  const supabase = await createClient();
  const name = formData.get("name")?.toString().trim();
  if (!name) return { error: "Category name is required." };

  const { error } = await supabase.from("inventory_categories").insert({ name });
  if (error) {
    if (error.code === "23505") return { error: `A category named "${name}" already exists.` };
    return { error: error.message };
  }
  revalidatePath("/inventory/categories");
  revalidatePath("/inventory/items");
  return { success: true };
}

export async function updateCategory(formData) {
  const supabase = await createClient();
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  if (!id) return { error: "Missing category." };
  if (!name) return { error: "Category name is required." };

  const { error } = await supabase.from("inventory_categories").update({ name }).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `A category named "${name}" already exists.` };
    return { error: error.message };
  }
  revalidatePath("/inventory/categories");
  revalidatePath("/inventory/items");
  return { success: true };
}

export async function toggleCategoryStatus(id, active) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_categories").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/categories");
  revalidatePath("/inventory/items");
  return { success: true };
}

// inventory_items.category_id is "on delete set null" — deleting a
// category never blocks on items that use it, they just lose the label.
export async function deleteCategory(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_categories").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/inventory/categories");
  revalidatePath("/inventory/items");
  return { success: true };
}
