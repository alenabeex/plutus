import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { cashflowView, ensureMonthsFromTransactions } from "../derive";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      sort INTEGER DEFAULT 0, grp TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, name TEXT, merchant TEXT,
      amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0,
      txn_class TEXT
    );
    CREATE TABLE budget_months (month TEXT PRIMARY KEY);
    -- cashflowView LEFT JOINs accounts for the drill-down source-account
    -- label (nickname/name + mask). Fixture rows never set account_id, so
    -- every join resolves to NULL — matches none of the existing assertions,
    -- this table just needs to exist so the query itself doesn't error.
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, nickname TEXT, name TEXT, mask TEXT
    );
  `);
  const cat = d.prepare(`INSERT INTO categories (name, sort, grp) VALUES (?, ?, ?)`);
  cat.run("Rent / Housing", 1, "need");
  cat.run("Utilities", 2, "need");
  cat.run("Groceries", 3, "want");
  cat.run("Eat Out", 4, "want");
  return d;
}

function txn(d: Database.Database, t: {
  date: string; name: string; merchant?: string; amount: number;
  category_id?: number; pending?: number; txn_class?: string;
}) {
  d.prepare(
    `INSERT INTO transactions (date, name, merchant, amount, category_id, pending, txn_class)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.date, t.name, t.merchant ?? null, t.amount, t.category_id ?? null,
        t.pending ?? 0, t.txn_class ?? "expense");
}

describe("cashflowView", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("groups expenses by category, ranked by amount desc", () => {
    txn(d, { date: "2026-07-01", name: "OAKWOOD ACH", merchant: "Oakwood Properties", amount: 1850, category_id: 1 });
    txn(d, { date: "2026-07-14", name: "SAFEWAY", merchant: "Safeway", amount: 112.25, category_id: 3 });
    txn(d, { date: "2026-07-21", name: "TRADER JOES", merchant: "Trader Joe's", amount: 63.2, category_id: 3 });
    const v = cashflowView("2026-07", d);
    expect(v.expenses.map((e) => e.label)).toEqual(["Rent / Housing", "Groceries"]);
    expect(v.expenses[1].value).toBe(175.45);
    expect(v.expenses[0].grp).toBe("need");
    expect(v.expenses[1].grp).toBe("want");
  });

  it("carries each row's transactions, newest first, merchant preferred over name", () => {
    txn(d, { date: "2026-07-14", name: "SAFEWAY #1234", merchant: "Safeway", amount: 112.25, category_id: 3 });
    txn(d, { date: "2026-07-21", name: "TJ MAIDEN LN", merchant: "Trader Joe's", amount: 63.2, category_id: 3 });
    const v = cashflowView("2026-07", d);
    const g = v.expenses.find((e) => e.label === "Groceries")!;
    expect(g.txns.map((t) => t.label)).toEqual(["Trader Joe's", "Safeway"]);
    expect(g.txns[0]).toMatchObject({ date: "2026-07-21", value: 63.2 });
  });

  it("buckets uncategorized expenses into their own row", () => {
    txn(d, { date: "2026-07-05", name: "MYSTERY POS", amount: 66.5 });
    const v = cashflowView("2026-07", d);
    expect(v.expenses).toHaveLength(1);
    expect(v.expenses[0].label).toBe("Uncategorized");
    expect(v.expenses[0].value).toBe(66.5);
    expect(v.expenses[0].grp).toBe("want");
  });

  it("splits needs and wants totals by category group (uncategorized counts as want)", () => {
    txn(d, { date: "2026-07-01", name: "RENT", amount: 1850, category_id: 1 });
    txn(d, { date: "2026-07-02", name: "PG&E", amount: 138.7, category_id: 2 });
    txn(d, { date: "2026-07-03", name: "SAFEWAY", amount: 175.45, category_id: 3 });
    txn(d, { date: "2026-07-04", name: "MYSTERY", amount: 66.5 });
    const v = cashflowView("2026-07", d);
    expect(v.totalNeeds).toBe(1988.7);
    expect(v.totalWants).toBe(241.95);
    expect(v.totalExpenses).toBe(2230.65);
  });

  it("groups income by payer with positive display values", () => {
    txn(d, { date: "2026-07-15", name: "ACME CORP PAYROLL", merchant: "Acme Corp", amount: -2600, txn_class: "income" });
    txn(d, { date: "2026-07-31", name: "ACME CORP PAYROLL", merchant: "Acme Corp", amount: -2600, txn_class: "income" });
    const v = cashflowView("2026-07", d);
    expect(v.income).toEqual([
      { label: "Acme Corp", value: 5200, txns: [
        { id: 2, date: "2026-07-31", label: "Acme Corp", value: 2600, account: "" },
        { id: 1, date: "2026-07-15", label: "Acme Corp", value: 2600, account: "" },
      ]},
    ]);
    expect(v.totalIncome).toBe(5200);
  });

  it("ignores pending, transfers, and other months", () => {
    txn(d, { date: "2026-07-10", name: "PENDING", amount: 50, category_id: 3, pending: 1 });
    txn(d, { date: "2026-07-11", name: "CC PAYMENT", amount: 500, txn_class: "transfer" });
    txn(d, { date: "2026-06-11", name: "LAST MONTH", amount: 40, category_id: 3 });
    const v = cashflowView("2026-07", d);
    expect(v.txnCount).toBe(0);
    expect(v.expenses).toEqual([]);
  });

  it("ignores disputed transactions (txn_class 'excluded')", () => {
    txn(d, { date: "2026-07-12", name: "DISPUTED CHARGE", amount: 45, category_id: 3, txn_class: "excluded" });
    const v = cashflowView("2026-07", d);
    expect(v.txnCount).toBe(0);
    expect(v.expenses).toEqual([]);
    expect(v.totalExpenses).toBe(0);
  });
});

describe("ensureMonthsFromTransactions", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("only materializes the current month from a multi-month backfill", () => {
    txn(d, { date: "2026-05-01", name: "OLD", amount: 10, category_id: 3 });
    txn(d, { date: "2026-06-01", name: "OLDER", amount: 10, category_id: 3 });
    txn(d, { date: "2026-07-01", name: "CURRENT", amount: 10, category_id: 3 });
    ensureMonthsFromTransactions(d, "2026-07");
    const rows = (d.prepare(`SELECT month FROM budget_months ORDER BY month`).all() as { month: string }[])
      .map((r) => r.month);
    expect(rows).toEqual(["2026-07"]);
  });

  it("grandfathers an existing past-month row", () => {
    d.prepare(`INSERT INTO budget_months (month) VALUES (?)`).run("2026-05");
    txn(d, { date: "2026-07-01", name: "CURRENT", amount: 10, category_id: 3 });
    ensureMonthsFromTransactions(d, "2026-07");
    const rows = (d.prepare(`SELECT month FROM budget_months ORDER BY month`).all() as { month: string }[])
      .map((r) => r.month);
    expect(rows).toEqual(["2026-05", "2026-07"]);
  });
});
