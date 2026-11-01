import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { addManualTxn, ManualTxnError } from "../add-manual-txn";
import { cashflowView } from "../derive";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER DEFAULT 0, grp TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, plaid_txn_id TEXT UNIQUE,
      date TEXT, name TEXT, merchant TEXT, amount REAL, category_id INTEGER,
      pending INTEGER DEFAULT 0, txn_class TEXT, pfc TEXT
    );
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, nickname TEXT, name TEXT, mask TEXT);
  `);
  d.prepare(`INSERT INTO categories (name, sort, grp) VALUES ('Groceries', 1, 'want')`).run();
  return d;
}

const row = (d: Database.Database, id: number) =>
  d.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;

// Manual cash entries (Alena 2026-10-30): a cash income, a cash expense or a
// saving with no linked account behind it. Plaid sign convention on disk —
// positive = money out — so the UI's positive dollars get signed here.
describe("addManualTxn", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("stores a cash income as a negative, pre-classified, account-less row", () => {
    const id = addManualTxn(d, { kind: "income", date: "2026-10-12", label: "Cash tips", amount: 80 });
    const r = row(d, id);
    expect(r.amount).toBe(-80);
    expect(r.txn_class).toBe("income");
    expect(r.account_id).toBeNull();
    expect(r.plaid_txn_id).toBeNull();
    expect(r.pending).toBe(0);
    expect(r.merchant).toBe("Cash tips");
  });

  it("stores a cash expense as positive with its category", () => {
    const id = addManualTxn(d, { kind: "expense", date: "2026-10-12", label: "Farmers market", amount: 32.5, categoryId: 1 });
    const r = row(d, id);
    expect(r.amount).toBe(32.5);
    expect(r.txn_class).toBe("expense");
    expect(r.category_id).toBe(1);
  });

  it("stores a saving as positive money out", () => {
    const id = addManualTxn(d, { kind: "saved", date: "2026-10-12", label: "Cash to savings jar", amount: 100 });
    expect(row(d, id).amount).toBe(100);
    expect(row(d, id).txn_class).toBe("saved");
  });

  it("rejects bad input with ManualTxnError instead of writing", () => {
    const bad = (input: Parameters<typeof addManualTxn>[1]) =>
      expect(() => addManualTxn(d, input)).toThrow(ManualTxnError);
    bad({ kind: "income", date: "2026-10-12", label: "", amount: 10 });
    bad({ kind: "income", date: "2026-10-12", label: "x", amount: 0 });
    bad({ kind: "income", date: "2026-10-12", label: "x", amount: -5 });
    bad({ kind: "income", date: "2026-10-12", label: "x", amount: 0.004 });      // rounds to $0.00
    bad({ kind: "income", date: "2026-10-12", label: "x", amount: 1e307 });      // overflows totals
    bad({ kind: "income", date: "10/12/2026", label: "x", amount: 5 });
    bad({ kind: "income", date: "2026-13-01", label: "x", amount: 5 });          // no month 13
    bad({ kind: "income", date: "2026-02-30", label: "x", amount: 5 });          // no Feb 30
    bad({ kind: "income", date: "2026-11-05", label: "x", amount: 5, month: "2026-10" }); // outside the viewed month
    bad({ kind: "expense", date: "2026-10-12", label: "x", amount: 5, categoryId: 999 });
    expect(d.prepare(`SELECT COUNT(*) n FROM transactions`).get()).toEqual({ n: 0 });
  });

  it("accepts a date inside the viewed month and rounds the amount to cents", () => {
    const id = addManualTxn(d, { kind: "expense", date: "2026-10-31", label: "x", amount: 12.345, month: "2026-10" });
    expect(row(d, id).amount).toBe(12.35);
  });

  it("surfaces in cashflowView in the right section with no account segment", () => {
    addManualTxn(d, { kind: "income", date: "2026-10-12", label: "Cash tips", amount: 80 });
    addManualTxn(d, { kind: "expense", date: "2026-10-13", label: "Farmers market", amount: 32.5, categoryId: 1 });
    addManualTxn(d, { kind: "saved", date: "2026-10-14", label: "Savings jar", amount: 100 });
    const v = cashflowView("2026-10", d);
    expect(v.totalIncome).toBe(80);
    expect(v.income[0]).toMatchObject({ label: "Cash tips", value: 80 });
    expect(v.income[0].txns[0].account).toBe("");
    expect(v.expenses[0]).toMatchObject({ label: "Groceries", value: 32.5 });
    expect(v.savedRows[0]).toMatchObject({ label: "Savings jar", value: 100 });
  });
});
