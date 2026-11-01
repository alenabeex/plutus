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
  date: string;        // YYYY-MM-DD, a real calendar date
  label: string;
  amount: number;      // positive dollars as the user typed them
  categoryId?: number; // expense only
  month?: string;      // YYYY-MM — when given, the date must fall inside it
}

/** Input the caller got wrong — the route answers these with a 400. Anything
 *  else thrown here (DB open, lock, disk) is a server error and stays one. */
export class ManualTxnError extends Error {}

const MAX_AMOUNT = 1_000_000_000;

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addManualTxn(d: Database.Database = db(), input: ManualTxnInput): number {
  const label = input.label.trim();
  if (!label || label.length > 80) throw new ManualTxnError("Label must be 1–80 characters");
  if (input.kind !== "income" && input.kind !== "expense" && input.kind !== "saved") throw new ManualTxnError("bad kind");
  if (!isCalendarDate(input.date)) throw new ManualTxnError("Date must be a real YYYY-MM-DD date");
  if (input.month !== undefined && !input.date.startsWith(`${input.month}-`)) {
    throw new ManualTxnError(`Date must be in ${input.month}`);
  }

  // Round first so sub-cent input can't become a $0.00 row; cap so a typo
  // can't overflow the month totals.
  const amount = Math.round(input.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0.01 || amount > MAX_AMOUNT) {
    throw new ManualTxnError("Amount must be between 0.01 and 1,000,000,000");
  }

  let categoryId: number | null = null;
  if (input.kind === "expense" && typeof input.categoryId === "number") {
    const cat = d.prepare(`SELECT id FROM categories WHERE id = ?`).get(input.categoryId);
    if (!cat) throw new ManualTxnError("category not found");
    categoryId = input.categoryId;
  }

  const signed = input.kind === "income" ? -amount : amount;
  const r = d.prepare(
    `INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, category_id, pending, txn_class)
     VALUES (NULL, NULL, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(input.date, label, label, signed, categoryId, input.kind);
  return Number(r.lastInsertRowid);
}
