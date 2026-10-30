import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";

// Manual cash entries (Alena 2026-10-30): cash income, a cash expense, or a
// saving that no linked account will ever report. Rows carry no account and
// no plaid_txn_id, so sync's removed-txn delete (keyed on plaid_txn_id)
// never touches them, and cashflowView's account segment renders empty.
// txn_class is written on insert — classifyTransactions only fills NULL
// rows, so these never get re-decided. Plaid sign convention on disk:
// positive = money out, so income is stored negative.

export type ManualTxnKind = "income" | "expense" | "saved";

export interface ManualTxnInput {
  kind: ManualTxnKind;
  date: string;        // YYYY-MM-DD
  label: string;
  amount: number;      // positive dollars as the user typed them
  categoryId?: number; // expense only
}

export function addManualTxn(d: Database.Database = db(), input: ManualTxnInput): number {
  const label = input.label.trim();
  if (!label || label.length > 80) throw new Error("Label must be 1–80 characters");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Amount must be greater than 0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Date must be YYYY-MM-DD");
  if (input.kind !== "income" && input.kind !== "expense" && input.kind !== "saved") throw new Error("bad kind");

  let categoryId: number | null = null;
  if (input.kind === "expense" && typeof input.categoryId === "number") {
    const cat = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(input.categoryId);
    if (!cat) throw new Error("category not found");
    categoryId = input.categoryId;
  }

  const amount = Math.round(input.amount * 100) / 100;
  const signed = input.kind === "income" ? -amount : amount;
  const r = d.prepare(
    `INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, category_id, pending, txn_class)
     VALUES (NULL, NULL, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(input.date, label, label, signed, categoryId, input.kind);
  return Number(r.lastInsertRowid);
}
