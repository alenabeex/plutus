import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { classifyTransactions, auditIncomeCandidates } from "../derive";

// Plaid sign convention throughout: positive = money out, negative = money in.

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, mask TEXT,
      kind TEXT, institution TEXT, cashflow_role TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, name TEXT, merchant TEXT,
      amount REAL, pfc TEXT, pending INTEGER DEFAULT 0, txn_class TEXT
    );
  `);
  d.prepare(`INSERT INTO accounts (id, name, kind, institution) VALUES (1, 'Everyday Checking', 'cash', 'Chase')`).run();
  d.prepare(`INSERT INTO accounts (id, name, kind, institution) VALUES (2, 'Travel Card', 'credit', 'Chase')`).run();
  return d;
}

function txn(d: Database.Database, t: {
  account_id?: number; date?: string; name: string; merchant?: string;
  amount: number; pfc?: string; pending?: number; txn_class?: string | null;
}): number {
  const r = d.prepare(
    `INSERT INTO transactions (account_id, date, name, merchant, amount, pfc, pending, txn_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.account_id ?? 1, t.date ?? "2026-08-10", t.name, t.merchant ?? null,
        t.amount, t.pfc ?? null, t.pending ?? 0, t.txn_class ?? null);
  return Number(r.lastInsertRowid);
}

const classOf = (d: Database.Database, id: number): string =>
  (d.prepare(`SELECT txn_class FROM transactions WHERE id = ?`).get(id) as { txn_class: string }).txn_class;

describe("classifyTransactions — income capture (deposits / transfer-shaped payroll)", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("classes a cash deposit as income despite its TRANSFER_IN_DEPOSIT pfc", () => {
    const id = txn(d, { name: "ATM CASH DEPOSIT 08/10", amount: -400, pfc: "TRANSFER_IN_DEPOSIT" });
    classifyTransactions(d);
    expect(classOf(d, id)).toBe("income");
  });

  it("classes deposit-text inflows as income even without a pfc", () => {
    const check = txn(d, { name: "MOBILE CHECK DEPOSIT", amount: -250 });
    const cash = txn(d, { name: "CASH DEPOSIT BRANCH 0042", amount: -120 });
    classifyTransactions(d);
    expect(classOf(d, check)).toBe("income");
    expect(classOf(d, cash)).toBe("income");
  });

  it("classes transfer-worded payroll as income when pfc says INCOME_*", () => {
    const id = txn(d, { name: "ACH TRANSFER FROM ACME CORP PAYROLL", merchant: "Acme Corp", amount: -2600, pfc: "INCOME_WAGES" });
    classifyTransactions(d);
    expect(classOf(d, id)).toBe("income");
  });

  it("keeps own-account moves and card payments as transfers", () => {
    const own = txn(d, { name: "ONLINE TRANSFER FROM SAVINGS", amount: -500, pfc: "TRANSFER_IN_ACCOUNT_TRANSFER" });
    const ccPay = txn(d, { account_id: 2, name: "PAYMENT THANK YOU", amount: -900, pfc: "TRANSFER_OUT_CREDIT_CARD_PAYMENT" });
    classifyTransactions(d);
    expect(classOf(d, own)).toBe("transfer");
    expect(classOf(d, ccPay)).toBe("transfer");
  });

  it("does not let deposit fingerprints turn outflows into income", () => {
    const id = txn(d, { name: "CHECK DEPOSIT RETURN ITEM", amount: 250 });
    classifyTransactions(d);
    expect(classOf(d, id)).toBe("expense");
  });

  it("upgrades machine-made 'transfer' inflows that match income fingerprints", () => {
    const old = txn(d, { name: "ATM CASH DEPOSIT", amount: -400, pfc: "TRANSFER_IN_DEPOSIT", txn_class: "transfer" });
    const ownMove = txn(d, { name: "ONLINE TRANSFER FROM SAVINGS", amount: -500, txn_class: "transfer" });
    classifyTransactions(d);
    expect(classOf(d, old)).toBe("income");
    expect(classOf(d, ownMove)).toBe("transfer");
  });
});

describe("auditIncomeCandidates", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("splits benched inflows into will-reclassify vs review, cash accounts only", () => {
    txn(d, { name: "ATM CASH DEPOSIT", amount: -400, pfc: "TRANSFER_IN_DEPOSIT", txn_class: "transfer" });
    txn(d, { name: "ZELLE TRANSFER FROM J DOE", amount: -75, txn_class: "transfer" });
    txn(d, { account_id: 2, name: "PAYMENT THANK YOU", amount: -900, txn_class: "transfer" }); // credit — out of scope
    txn(d, { name: "SAFEWAY", amount: 60, txn_class: "expense" });                             // not a transfer

    const rows = auditIncomeCandidates(d);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.label.includes("ATM"))!.verdict).toBe("will-reclassify");
    const zelle = rows.find((r) => r.label.includes("ZELLE"))!;
    expect(zelle.verdict).toBe("review");
    expect(zelle.reason).toContain("transfer from");
  });

  it("mutates nothing", () => {
    const id = txn(d, { name: "ATM CASH DEPOSIT", amount: -400, txn_class: "transfer" });
    auditIncomeCandidates(d);
    expect(classOf(d, id)).toBe("transfer");
  });
});
