import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import { isValidMonthKey } from "./format";

// Month move (Alena 2026-11-14): file a transaction under a different Cash
// Flow month than the one its date falls in — a paycheck that posts on the
// 31st but belongs to next month, rent that clears a day early. The date is
// never edited: Plaid owns it and a modified event would write it straight
// back. Only transactions.cashflow_month changes, and every month-scoped
// Cash Flow query reads TXN_MONTH_SQL (lib/derive) instead of the raw date.

/** Input the caller got wrong — the route answers these with a 400. Anything
 *  else thrown here (DB open, lock, disk) is a server error and stays one. */
export class MoveMonthError extends Error {}

export function moveTxnMonth(
  d: Database.Database = db(),
  id: number,
  month: unknown,
  nowMonth: string = new Date().toISOString().slice(0, 7),
): void {
  if (!isValidMonthKey(month)) throw new MoveMonthError("bad-month");
  if (month > nowMonth) throw new MoveMonthError("Can't move a transaction into a future month");

  const txn = d.prepare(`SELECT date FROM transactions WHERE id = ?`).get(id) as { date: string | null } | undefined;
  if (!txn) throw new MoveMonthError("transaction not found");

  // Sheet-imported months render their stored totals with no drill-down, so
  // a transaction filed there would vanish with no way to get it back.
  const target = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as { source?: string | null } | undefined;
  if (target?.source === "sheet") {
    throw new MoveMonthError("That month was imported from a sheet and can't take transactions");
  }

  // Back in the month of its own date → no override, so the row is
  // indistinguishable from one that was never moved.
  const override = txn.date?.slice(0, 7) === month ? null : month;
  d.prepare(`UPDATE transactions SET cashflow_month = ? WHERE id = ?`).run(override, id);
}
