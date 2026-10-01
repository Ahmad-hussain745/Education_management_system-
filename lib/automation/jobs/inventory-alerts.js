// Flags active items at or below their reorder_level (the schema's
// "minimum stock" — see reorder_level's comment in 0028_inventory.sql).
// Items with a null reorder_level aren't tracked and are ignored.
//
// UPDATED (0050): each low item now also gets a real staff_notifications
// row via upsert_low_stock_notification() — not just a line in this run's
// summary JSON. That's the actual "Notification" step in 12 < 20 → Low
// stock → Notification: something a staff member can see and dismiss, not
// only something that shows up if someone happens to open the Automation
// Center. Items no longer low (restocked, or reorder_level changed) have
// their notification closed via close_resolved_low_stock_notifications()
// in the same run — this job is always the single source of truth for
// which low_stock notifications should currently be open, so it reconciles
// the full set every time rather than only ever adding.
export const inventoryAlertsJob = {
  key: "inventory-alerts",
  name: "Low Stock Alerts",

  async run({ admin, institute }) {
    const { data, error } = await admin.rpc("low_stock_items", { p_institute_id: institute.id });
    if (error) throw new Error(error.message);

    const low = data || [];

    for (const item of low) {
      const { error: upsertError } = await admin.rpc("upsert_low_stock_notification", {
        p_institute_id: institute.id,
        p_item_id: item.item_id,
        p_item_name: item.item_name,
        p_unit: item.unit,
        p_remaining: item.remaining,
        p_reorder_level: item.reorder_level,
      });
      // One item's notification failing to write shouldn't stop the rest
      // from being flagged — collect it into the summary instead of
      // throwing and losing the other N-1.
      if (upsertError) {
        console.error(`[inventory-alerts] notification failed for ${item.item_name}:`, upsertError.message);
      }
    }

    const { error: closeError } = await admin.rpc("close_resolved_low_stock_notifications", {
      p_institute_id: institute.id,
      p_still_low_item_ids: low.map((i) => i.item_id),
    });
    if (closeError) console.error("[inventory-alerts] could not close resolved notifications:", closeError.message);

    return {
      itemsProcessed: low.length,
      summary: {
        low_stock_count: low.length,
        items: low.slice(0, 20).map((i) => ({
          name: i.item_name,
          remaining: Number(i.remaining),
          reorder_level: Number(i.reorder_level),
          unit: i.unit,
        })),
      },
    };
  },
};
