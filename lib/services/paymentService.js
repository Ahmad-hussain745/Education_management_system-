"use client";

import { paymentRepository } from "@/lib/repositories/paymentRepository";

export const paymentService = {
  async recordPayment({ feeRecordId, studentId, month, amount, method, remarks, isAdvance, idempotencyKey }) {
    if (!feeRecordId || !studentId || !month) throw new Error("Pick a student to load their bill before recording a payment.");
    if (!amount || Number(amount) <= 0) throw new Error("Enter an amount greater than 0.");

    return paymentRepository.create({ feeRecordId, studentId, month, amount: Number(amount), method, remarks, isAdvance, idempotencyKey });
  },
};
