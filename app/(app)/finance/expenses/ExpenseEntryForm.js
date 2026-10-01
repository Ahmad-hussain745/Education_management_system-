"use client";

import { useState, useEffect } from "react";
import { expenseService } from "@/lib/services/expenseService";
import { subscribeConnectivity } from "@/lib/offline/connectivity";

// The five standard categories, offered as quick picks. "Other" reveals a
// free-text field rather than silently filing everything unrecognised
// under one bucket — the category column is plain text server-side (see
// 0001_init.sql), and existing rows use values like "Utilities"/"Rent", so
// this deliberately doesn't constrain it to an enum that would reject
// historical entries or an institute's own naming.
const QUICK_CATEGORIES = ["Electricity", "Stationery", "Maintenance", "Transport", "Other"];

const METHODS = ["Cash", "Bank Transfer", "Cheque", "Easypaisa", "JazzCash", "Card"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenseEntryForm({ instituteId, paidByUserId }) {
  const [category, setCategory] = useState("Electricity");
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [expenseDate, setExpenseDate] = useState(todayStr());
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => subscribeConnectivity(setOnline), []);

  const resolvedCategory = category === "Other" ? customCategory.trim() : category;

  const reset = () => {
    setAmount("");
    setDescription("");
    setCustomCategory("");
    setCategory("Electricity");
    setMethod("Cash");
    setExpenseDate(todayStr());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const res = await expenseService.recordExpense({
        instituteId,
        category: resolvedCategory,
        description: description.trim() || null,
        amount,
        method,
        expenseDate,
        paidBy: paidByUserId,
      });
      if (res.mode === "offline") {
        setMessage(
          `🟠 Saved locally — ${fmtAmount(amount)} for ${resolvedCategory}. It posts to the Cash/Bank ledger automatically once you're back online.`
        );
      } else if (res.posted === false) {
        setMessage(
          `Filed for approval — ${fmtAmount(amount)} for ${resolvedCategory} is at or above the large-expense threshold, so it needs a Principal's (or Super Admin's) sign-off before it posts to the ledger.`
        );
      } else {
        setMessage(`Recorded ${fmtAmount(amount)} for ${resolvedCategory}.`);
      }
      reset();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
      {!online && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm">
          🟠 Offline — expenses you record now are saved on this device and sync automatically when the
          connection returns. The ledger and audit entries are created at that point, not before.
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Category</label>
        <div className="flex flex-wrap gap-2">
          {QUICK_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={
                "px-3 py-1.5 rounded-lg text-sm border transition " +
                (category === c
                  ? "bg-royal text-white border-royal"
                  : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
              }
            >
              {c}
            </button>
          ))}
        </div>
        {category === "Other" && (
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            required
            placeholder="Type the category — e.g. Rent, Repairs, Internet"
            className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
          <input
            type="number" min="0" step="0.01" required value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input
            type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description (optional)</label>
        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-brick">{error}</p>}
      {message && <p className="text-sm text-sage">{message}</p>}

      <button type="submit" disabled={pending} className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60">
        {pending ? "Saving…" : online ? "Record Expense" : "Save Offline"}
      </button>
    </form>
  );
}

function fmtAmount(n) {
  return "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-US");
}
