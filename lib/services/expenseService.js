"use client";

import { expenseRepository } from "@/lib/repositories/expenseRepository";

export const expenseService = {
  async recordExpense({ instituteId, category, description, amount, method, expenseDate, paidBy }) {
    if (!category?.trim()) throw new Error("Category is required.");
    if (!amount || Number(amount) <= 0) throw new Error("Enter an amount greater than 0.");
    if (!expenseDate) throw new Error("Date is required.");

    return expenseRepository.create({ instituteId, category: category.trim(), description, amount: Number(amount), method, expenseDate, paidBy });
  },

  async getRecent({ instituteId, limit }) {
    return expenseRepository.getRecent({ instituteId, limit });
  },
};
