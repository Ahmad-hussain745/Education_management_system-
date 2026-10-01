"use client";

import { getConnectivity } from "@/lib/offline/connectivity";
import { recordExpense } from "@/app/(app)/finance/expenses/actions";
import * as offlineExpenses from "@/lib/offline/repositories/expenses";

export const expenseRepository = {
  async create({ instituteId, category, description, amount, method, expenseDate, paidBy }) {
    if (getConnectivity()) {
      const formData = new FormData();
      formData.set("category", category);
      if (description) formData.set("description", description);
      formData.set("amount", String(amount));
      formData.set("method", method || "Cash");
      formData.set("expense_date", expenseDate);
      // Generated once per submit — a genuine network failure below falls
      // through to the offline queue (a different entity entirely, its own
      // idempotency key), so this key only ever needs to protect against
      // this one online attempt's own response getting lost, not a retry
      // across branches.
      formData.set("idempotency_key", crypto.randomUUID());
      try {
        const result = await recordExpense(formData);
        if (result?.error) {
          // A MONTH_CLOSED rejection is the server correctly refusing this
          // entry, not a connectivity problem — queuing it offline would
          // just recreate the same refusal at sync time, except hours
          // later and without the person who could act on it standing
          // there. Surface it now instead.
          const err = new Error(result.error);
          err.isBusinessRule = /closed|not authorized|MONTH_CLOSED/i.test(result.error);
          throw err;
        }
        return { mode: "online", ...result };
      } catch (err) {
        if (err.isBusinessRule) throw err;
        // Genuine network/transport failure — thought we were online,
        // weren't. Queue rather than lose what was typed.
        return await this._createOffline({ instituteId, category, description, amount, method, expenseDate, paidBy });
      }
    }
    return await this._createOffline({ instituteId, category, description, amount, method, expenseDate, paidBy });
  },

  async _createOffline(args) {
    const record = await offlineExpenses.logExpenseOffline(args);
    return { mode: "offline", record };
  },

  async getRecent({ instituteId, limit = 50 }) {
    return offlineExpenses.getRecentExpenses(instituteId, limit);
  },
};
