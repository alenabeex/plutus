import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { cashflowView, ensureMonthsFromTransactions, monthShowsDerived } from "../derive";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      sort INTEGER DEFAULT 0, grp TEXT, icon TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, name TEXT, merchant TEXT,
      amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0,
      txn_class TEXT, date_override TEXT
    );
    CREATE TABLE budget_months (month TEXT PRIMARY KEY);
    -- cashflowView LEFT JOINs accounts for the drill-down source-account
    -- label (nickname/name + mask) and for the account role that decides
    -- whether a classifier 'transfer' row shows in the Transfer folder.
    -- Most fixture rows set no account_id, so the join resolves to NULL;
    -- the Transfer-folder tests insert their own accounts.
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, nickname TEXT, name TEXT, mask TEXT,
      kind TEXT, institution TEXT, cashflow_role TEXT
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
  category_id?: number; pending?: number; txn_class?: string; date_override?: string;
  account_id?: number;
}) {
  d.prepare(
    `INSERT INTO transactions (account_id, date, name, merchant, amount, category_id, pending, txn_class, date_override)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.account_id ?? null, t.date, t.name, t.merchant ?? null, t.amount, t.category_id ?? null,
        t.pending ?? 0, t.txn_class ?? "expense", t.date_override ?? null);
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

  it("ignores pending and other months; a transfer counts in no total", () => {
    txn(d, { date: "2026-07-10", name: "PENDING", amount: 50, category_id: 3, pending: 1 });
    txn(d, { date: "2026-07-11", name: "CC PAYMENT", amount: 500, txn_class: "transfer" });
    txn(d, { date: "2026-06-11", name: "LAST MONTH", amount: 40, category_id: 3 });
    const v = cashflowView("2026-07", d);
    expect(v.txnCount).toBe(0);
    expect(v.expenses).toEqual([]);
    expect(v.totalExpenses).toBe(0);
    expect(v.transfers?.txns.map((t) => t.label)).toEqual(["CC PAYMENT"]);
  });

  it("ignores disputed transactions (txn_class 'excluded')", () => {
    txn(d, { date: "2026-07-12", name: "DISPUTED CHARGE", amount: 45, category_id: 3, txn_class: "excluded" });
    const v = cashflowView("2026-07", d);
    expect(v.txnCount).toBe(0);
    expect(v.expenses).toEqual([]);
    expect(v.totalExpenses).toBe(0);
  });

  // Manual Transfer destination (Alena 2026-11-14): own-account moves the
  // classifier got wrong. One visible folder, in no total — and stored as
  // 'transfer_manual', never the machine's 'transfer'.
  it("collects manual transfers into one folder that counts in no total", () => {
    txn(d, { date: "2026-07-03", name: "ZELLE FROM SELF", amount: -200, txn_class: "transfer_manual" });
    txn(d, { date: "2026-07-09", name: "MOVE TO JOINT", amount: 75, category_id: 3, txn_class: "transfer_manual" });
    const v = cashflowView("2026-07", d);
    expect(v.transfers?.label).toBe("Transfer");
    // header = the larger side (200 in vs 75 out), never the 275 sum
    expect(v.transfers?.value).toBe(200);
    expect(v.transfers?.txns.map((t) => t.value)).toEqual([75, 200]);
    expect(v.totalIncome).toBe(0);
    expect(v.totalExpenses).toBe(0);
    expect(v.txnCount).toBe(0);
  });

  // Every settled transaction on a cash or card account must be visible
  // somewhere (Alena 2026-11-14: "I don't see any withdrawals"). Plaid tags
  // ATM withdrawals TRANSFER_OUT_WITHDRAWAL, so the classifier benches them
  // as 'transfer' — they belong in the folder, where they can be re-filed.
  it("lists machine-classified transfers from cash accounts in the folder", () => {
    d.prepare(`INSERT INTO accounts (id, name, kind) VALUES (1, 'Everyday Checking', 'cash')`).run();
    txn(d, { account_id: 1, date: "2026-07-03", name: "ATM WITHDRAWAL", amount: 60, txn_class: "transfer" });
    const v = cashflowView("2026-07", d);
    expect(v.transfers?.txns.map((t) => t.label)).toEqual(["ATM WITHDRAWAL"]);
    expect(v.transfers?.value).toBe(60);
    expect(v.totalExpenses).toBe(0);
    expect(v.txnCount).toBe(0);
  });

  it("keeps investment-account activity out of the folder", () => {
    d.prepare(`INSERT INTO accounts (id, name, kind) VALUES (2, 'Brokerage', 'investment')`).run();
    txn(d, { account_id: 2, date: "2026-07-03", name: "BUY VTI", amount: 500, txn_class: "transfer" });
    expect(cashflowView("2026-07", d).transfers).toBeNull();
  });

  it("shows a two-leg card payment once in the folder header", () => {
    d.prepare(`INSERT INTO accounts (id, name, kind) VALUES (1, 'Everyday Checking', 'cash')`).run();
    d.prepare(`INSERT INTO accounts (id, name, kind) VALUES (3, 'Travel Card', 'credit')`).run();
    txn(d, { account_id: 1, date: "2026-07-20", name: "CARD PAYMENT", amount: 500, txn_class: "transfer" });
    txn(d, { account_id: 3, date: "2026-07-20", name: "PAYMENT THANK YOU", amount: -500, txn_class: "transfer" });
    const v = cashflowView("2026-07", d);
    expect(v.transfers?.txns).toHaveLength(2);
    expect(v.transfers?.value).toBe(500);
  });

  // Date edit (Alena 2026-11-14): date_override re-dates a transaction, and
  // it counts as an entry for that date's month.
  it("files a transaction under its date_override, and reports the bank date", () => {
    txn(d, { date: "2026-07-31", name: "EARLY PAYCHECK", amount: -3000, txn_class: "income", date_override: "2026-08-01" });
    expect(cashflowView("2026-07", d).txnCount).toBe(0);
    const aug = cashflowView("2026-08", d);
    expect(aug.totalIncome).toBe(3000);
    expect(aug.income[0].txns[0].date).toBe("2026-08-01");
    expect(aug.income[0].txns[0].bankDate).toBe("2026-07-31");
  });

  it("carries no bankDate on a transaction that was never re-dated", () => {
    txn(d, { date: "2026-07-14", name: "SAFEWAY", amount: 20, category_id: 3 });
    expect(cashflowView("2026-07", d).expenses[0].txns[0]).not.toHaveProperty("bankDate");
  });
});

// Which payload a non-sheet month renders (review of PR 6): a month whose
// only rows sit in the Transfer / Disputed folders must still render them.
describe("monthShowsDerived", () => {
  const folder = { label: "Transfer", value: 60, txns: [] };
  const empty = { total_income: 0, total_fixed: 0, total_variable: 0 };

  it("is derived whenever counted rows exist", () => {
    expect(monthShowsDerived({ txnCount: 1, transfers: null, disputed: null }, { total_income: 4000 })).toBe(true);
  });
  it("is derived for a folder-only month with no stored numbers", () => {
    expect(monthShowsDerived({ txnCount: 0, transfers: folder, disputed: null }, empty)).toBe(true);
    expect(monthShowsDerived({ txnCount: 0, transfers: null, disputed: folder }, empty)).toBe(true);
  });
  it("keeps stored numbers on screen when a folder is all the month has", () => {
    expect(monthShowsDerived({ txnCount: 0, transfers: folder, disputed: null }, { total_income: 4000 })).toBe(false);
  });
  it("is not derived for a month with nothing at all", () => {
    expect(monthShowsDerived({ txnCount: 0, transfers: null, disputed: null }, empty)).toBe(false);
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
