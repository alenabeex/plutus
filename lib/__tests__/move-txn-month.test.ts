import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { moveTxnMonth, MoveMonthError } from "../move-txn-month";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, date TEXT, name TEXT, amount REAL,
      txn_class TEXT, cashflow_month TEXT
    );
    CREATE TABLE budget_months (month TEXT PRIMARY KEY, source TEXT);
  `);
  d.prepare(`INSERT INTO transactions (id, date, name, amount, txn_class) VALUES (1, '2026-07-31', 'EARLY PAYCHECK', -3000, 'income')`).run();
  return d;
}

const monthOf = (d: Database.Database) =>
  (d.prepare(`SELECT cashflow_month m FROM transactions WHERE id = 1`).get() as { m: string | null }).m;

// Month move (Alena 2026-11-14): file a transaction under a different Cash
// Flow month than its posting date. The date itself is never edited — Plaid
// owns it — only the cashflow_month override.
describe("moveTxnMonth", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("stores the override and leaves the date alone", () => {
    moveTxnMonth(d, 1, "2026-08", "2026-11");
    expect(monthOf(d)).toBe("2026-08");
    expect((d.prepare(`SELECT date FROM transactions WHERE id = 1`).get() as { date: string }).date).toBe("2026-07-31");
  });

  it("clears the override when moved back to the month of its own date", () => {
    moveTxnMonth(d, 1, "2026-08", "2026-11");
    moveTxnMonth(d, 1, "2026-07", "2026-11");
    expect(monthOf(d)).toBeNull();
  });

  it("rejects a malformed month, a future month, and an unknown transaction", () => {
    expect(() => moveTxnMonth(d, 1, "2026-13", "2026-11")).toThrow(MoveMonthError);
    expect(() => moveTxnMonth(d, 1, "2026-12", "2026-11")).toThrow(MoveMonthError);
    expect(() => moveTxnMonth(d, 99, "2026-08", "2026-11")).toThrow(MoveMonthError);
    expect(monthOf(d)).toBeNull();
  });

  it("rejects a sheet-imported month — those never itemize transactions", () => {
    d.prepare(`INSERT INTO budget_months (month, source) VALUES ('2026-06', 'sheet')`).run();
    expect(() => moveTxnMonth(d, 1, "2026-06", "2026-11")).toThrow(MoveMonthError);
    expect(monthOf(d)).toBeNull();
  });
});
