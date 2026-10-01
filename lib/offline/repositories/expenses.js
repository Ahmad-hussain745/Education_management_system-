import { db } from "../db";
import { enqueue } from "../sync/outbox";

// Expenses have no cross-device race the way fee payments do — an expense
// is one person logging one institution's own spending, not two parties
// racing to affect a shared balance. A sync failure here is realistically
// only ever a network/auth error, not a legitimate business-rule
// rejection, so retry-on-reconnect is the whole story — no conflict UI
// needed for this table.

export async function logExpenseOffline({ instituteId, category, description, amount, method, expenseDate, paidBy }) {
  const localId = crypto.randomUUID();
  const record = {
    local_id: localId,
    institute_id: instituteId,
    category,
    description: description || null,
    amount,
    method: method || "Cash",
    expense_date: expenseDate,
    paid_by: paidBy,
    synced: false,
    created_at: new Date().toISOString(),
  };
  await db.expenses.put(record);
  const { idempotencyKey } = await enqueue({
    entity: "expenses",
    entityId: localId,
    payload: {
      category,
      description: description || null,
      amount,
      method: method || "Cash",
      expense_date: expenseDate,
      paid_by: paidBy,
    },
  });
  await db.expenses.update(localId, { idempotency_key: idempotencyKey });
  return record;
}

export async function getRecentExpenses(instituteId, limit = 50) {
  return db.expenses.where({ institute_id: instituteId }).reverse().sortBy("expense_date").then((r) => r.slice(0, limit));
}

export async function markSynced(localId, result) {
  return db.expenses.update(localId, {
    synced: true,
    // Phase 26: a synced expense doesn't necessarily mean POSTED anymore —
    // request_expense() (0056) may have filed this as a pending approval
    // instead, if it landed at or above the institute's large-expense
    // threshold. Recorded here for any future UI that wants to show that
    // distinction; PendingExpenses.js today only reads `synced`, so this
    // doesn't change what's currently displayed, only what's available to.
    posted: result?.posted ?? true,
    request_status: result?.posted === false ? "pending" : null,
  });
}
