import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import { monthLabel } from "./format";
import { cashflowView, storedMonthIsEmpty } from "./derive";

// Date edit (Alena 2026-11-14): give a transaction the date it really
// belongs to — a paycheck that posts on the 31st but is next month's, rent
// that clears a day early — and it counts as an entry for that date's month.
// transactions.date is never edited: Plaid owns it and every "modified"
// event writes it straight back (lib/apply-modified-txn). The edit lives in
// transactions.date_override, and every Cash Flow query reads TXN_DATE_SQL /
// TXN_MONTH_SQL (lib/derive) instead of the raw date.

/** Input the caller got wrong — the route answers these with a 400. Anything
 *  else thrown here (DB open, lock, disk) is a server error and stays one. */
export class TxnDateError extends Error {}

function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `nowMonth` is the server's (UTC) month — months from it onward
 *  materialize on their own, same rule as ensureMonthsFromTransactions.
 *  `maxMonth` is the latest month that is "now" anywhere on earth (UTC+14),
 *  so a user west or east of UTC on a month boundary is never refused their
 *  own current month, and nobody can file into a month the picker can't
 *  reach for more than a few hours. */
export function setTxnDate(
  d: Database.Database = db(),
  id: number,
  date: unknown,
  nowMonth: string = new Date().toISOString().slice(0, 7),
  maxMonth: string = new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 7),
): void {
  if (!isCalendarDate(date)) throw new TxnDateError("Date must be a real YYYY-MM-DD date");
  const month = date.slice(0, 7);
  if (month > maxMonth) throw new TxnDateError("Can't file a transaction in a future month");

  const txn = d.prepare(`SELECT date FROM transactions WHERE id = ?`).get(id) as { date: string | null } | undefined;
  if (!txn) throw new TxnDateError("transaction not found");

  // Back on its own bank date → no override, so the row is indistinguishable
  // from one that was never edited. Always allowed: it is where the row
  // would be anyway.
  if (txn.date === date) {
    d.prepare(`UPDATE transactions SET date_override = NULL WHERE id = ?`).run(id);
    return;
  }

  // The target month must be one the transaction stays reachable in.
  const target = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as
    { source?: string | null; total_income?: number; total_fixed?: number; total_variable?: number } | undefined;
  if (!target) {
    // A past month with no row is a gated backfill month (spec 2026-07-28):
    // its Sync Month gate only counts income/expense rows, so a Savings,
    // Disputed or Transfer row filed there could be reached from nowhere.
    if (month < nowMonth) throw new TxnDateError(`Sync ${monthLabel(month)} first, then move transactions into it`);
    d.prepare(`INSERT OR IGNORE INTO budget_months (month) VALUES (?)`).run(month);
  } else if (target.source === "sheet") {
    // Sheet months render stored totals with no drill-down.
    throw new TxnDateError(`${monthLabel(month)} was imported from a sheet and can't take transactions`);
  } else if (month < nowMonth && !storedMonthIsEmpty(target) && cashflowView(month, d).txnCount === 0) {
    // A past month still showing its stored numbers would flip to the live
    // view with just this one row and hide them — the hazard the Add button
    // already guards against. The current month is exempt: sync creates its
    // row by copying last month's fixed bills forward (lib/budget-ops), so
    // it carries a non-zero total_fixed before anything has posted, and it
    // turns live on its own with the first transaction anyway.
    throw new TxnDateError(`${monthLabel(month)} shows saved totals and can't take transactions`);
  }

  d.prepare(`UPDATE transactions SET date_override = ? WHERE id = ?`).run(date, id);
}
