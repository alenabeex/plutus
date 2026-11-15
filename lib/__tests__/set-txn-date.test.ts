import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { setTxnDate, TxnDateError } from "../set-txn-date";
import { cashflowView } from "../derive";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, sort INTEGER, grp TEXT);
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, nickname TEXT, name TEXT, mask TEXT,
      kind TEXT, institution TEXT, cashflow_role TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, name TEXT, merchant TEXT,
      amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0,
      txn_class TEXT, date_override TEXT
    );
    CREATE TABLE budget_months (
      month TEXT PRIMARY KEY, source TEXT DEFAULT 'app',
      total_income REAL DEFAULT 0, total_fixed REAL DEFAULT 0, total_variable REAL DEFAULT 0
    );
  `);
  d.prepare(`INSERT INTO transactions (id, date, name, amount, txn_class) VALUES (1, '2026-07-31', 'EARLY PAYCHECK', -3000, 'income')`).run();
  d.prepare(`INSERT INTO budget_months (month) VALUES ('2026-07'), ('2026-08')`).run();
  return d;
}

const override = (d: Database.Database) =>
  (d.prepare(`SELECT date_override o FROM transactions WHERE id = 1`).get() as { o: string | null }).o;
const NOW = "2026-11";
const set = (d: Database.Database, date: unknown, id = 1) => setTxnDate(d, id, date, NOW, NOW);

// Date edit (Alena 2026-11-14): re-date a transaction so it counts as an
// entry for that date's month. The bank's date is never edited — Plaid owns
// it — only the date_override.
describe("setTxnDate", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("stores the override, leaves the bank date alone, and moves the entry", () => {
    set(d, "2026-08-01");
    expect(override(d)).toBe("2026-08-01");
    expect((d.prepare(`SELECT date FROM transactions WHERE id = 1`).get() as { date: string }).date).toBe("2026-07-31");
    expect(cashflowView("2026-07", d).totalIncome).toBe(0);
    expect(cashflowView("2026-08", d).totalIncome).toBe(3000);
  });

  it("clears the override when set back to the bank date", () => {
    set(d, "2026-08-01");
    set(d, "2026-07-31");
    expect(override(d)).toBeNull();
  });

  it("allows a different day inside the same month", () => {
    set(d, "2026-07-15");
    expect(cashflowView("2026-07", d).income[0].txns[0].date).toBe("2026-07-15");
  });

  it("rejects a malformed or impossible date, a future month, and an unknown transaction", () => {
    expect(() => set(d, "2026-08")).toThrow(TxnDateError);
    expect(() => set(d, "2026-02-30")).toThrow(TxnDateError);
    expect(() => set(d, "2026-12-01")).toThrow(TxnDateError);
    expect(() => set(d, "2026-08-01", 99)).toThrow(TxnDateError);
    expect(override(d)).toBeNull();
  });

  it("rejects a sheet-imported month — those never itemize transactions", () => {
    d.prepare(`INSERT INTO budget_months (month, source) VALUES ('2026-06', 'sheet')`).run();
    expect(() => set(d, "2026-06-30")).toThrow(TxnDateError);
    expect(override(d)).toBeNull();
  });

  // A gated backfill month has no budget_months row and its Sync Month gate
  // counts only income/expense rows — a row filed there could be stranded.
  it("rejects a past month that was never synced", () => {
    expect(() => set(d, "2026-05-31")).toThrow(/Sync MAY 2026 first/);
    expect(override(d)).toBeNull();
  });

  it("materializes the current month when it has no row yet", () => {
    set(d, "2026-11-01");
    expect(override(d)).toBe("2026-11-01");
    expect(d.prepare(`SELECT 1 FROM budget_months WHERE month = '2026-11'`).get()).toBeTruthy();
  });

  it("rejects a month still showing stored totals — the live view would hide them", () => {
    d.prepare(`INSERT INTO budget_months (month, total_income) VALUES ('2026-04', 4000)`).run();
    expect(() => set(d, "2026-04-30")).toThrow(TxnDateError);
    expect(override(d)).toBeNull();
  });

  it("allows the reset even when the transaction's own month has since become unreachable", () => {
    set(d, "2026-08-01");
    d.prepare(`DELETE FROM budget_months WHERE month = '2026-07'`).run();
    set(d, "2026-07-31");
    expect(override(d)).toBeNull();
  });
});
