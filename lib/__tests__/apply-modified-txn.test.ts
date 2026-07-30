import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { applyModifiedTxn } from "../apply-modified-txn";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, plaid_txn_id TEXT UNIQUE,
      date TEXT, name TEXT, merchant TEXT, amount REAL, category_id INTEGER,
      pending INTEGER DEFAULT 0, txn_class TEXT, pfc TEXT
    );
  `);
  return d;
}

// Data-loss bug fix (2026-07-29): a Plaid "modified" event used to be applied
// as delete+reinsert, which wiped txn_class/category_id/merchant rename on
// every routine pending→settled transition. These pin applyModifiedTxn's
// in-place UPDATE so a manual move survives every future "modified" event.
describe("applyModifiedTxn", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("updates Plaid-owned fields but preserves txn_class, category_id, and a merchant rename", () => {
    d.prepare(
      `INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, category_id, pending, txn_class, pfc)
       VALUES (1, 'txn-1', '2026-07-01', 'ROBINHOOD ACH', 'My Brokerage', 500, 3, 1, 'saved', 'TRANSFER_OUT')`,
    ).run();

    applyModifiedTxn(d, 1, {
      plaidTxnId: "txn-1",
      date: "2026-07-02",
      name: "ROBINHOOD ACH",
      merchant: "Robinhood", // Plaid's own name — must NOT overwrite the user's rename
      amount: 501.5,
      pending: false, // settled now — the routine transition that used to trigger the wipe
      pfc: "TRANSFER_OUT",
    });

    const row = d.prepare(`SELECT * FROM transactions WHERE plaid_txn_id = 'txn-1'`).get() as {
      date: string; amount: number; pending: number; txn_class: string; category_id: number; merchant: string;
    };
    expect(row.date).toBe("2026-07-02");
    expect(row.amount).toBe(501.5);
    expect(row.pending).toBe(0);
    expect(row.txn_class).toBe("saved");
    expect(row.category_id).toBe(3);
    expect(row.merchant).toBe("My Brokerage");
  });

  it("fills merchant from the modified payload when the stored value is NULL", () => {
    d.prepare(
      `INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, pending, txn_class)
       VALUES (1, 'txn-2', '2026-07-01', 'UNKNOWN POS', NULL, 42, 1, NULL)`,
    ).run();

    applyModifiedTxn(d, 1, {
      plaidTxnId: "txn-2",
      date: "2026-07-01",
      name: "UNKNOWN POS",
      merchant: "Corner Store",
      amount: 42,
      pending: false,
      pfc: null,
    });

    const row = d.prepare(`SELECT merchant FROM transactions WHERE plaid_txn_id = 'txn-2'`).get() as
      { merchant: string | null };
    expect(row.merchant).toBe("Corner Store");
  });

  it("inserts fresh when the plaid_txn_id doesn't exist locally yet (modified before ever added)", () => {
    applyModifiedTxn(d, 7, {
      plaidTxnId: "txn-3",
      date: "2026-07-05",
      name: "NEW MERCHANT",
      merchant: "New Merchant",
      amount: 25,
      pending: true,
      pfc: "GENERAL_MERCHANDISE",
    });

    const row = d.prepare(`SELECT * FROM transactions WHERE plaid_txn_id = 'txn-3'`).get() as
      { account_id: number; amount: number; pending: number; txn_class: string | null } | undefined;
    expect(row).toBeTruthy();
    expect(row!.account_id).toBe(7);
    expect(row!.amount).toBe(25);
    expect(row!.pending).toBe(1);
    expect(row!.txn_class).toBeNull();
  });
});
