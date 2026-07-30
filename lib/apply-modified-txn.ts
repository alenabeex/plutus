import type Database from "better-sqlite3-multiple-ciphers";

// Kept in its own file, deliberately dependency-free (only the Database
// type) — lib/sync.ts (its one caller) transitively imports lib/plaid.ts,
// which imports @/lib/keychain via a path alias vitest doesn't resolve
// (no vitest.config.ts in this project). Importing applyModifiedTxn from
// "./sync" in a test would drag that whole chain in and fail to load;
// importing it from here doesn't.

export interface ModifiedTxnFields {
  plaidTxnId: string;
  date: string;
  name: string;
  merchant: string | null;
  amount: number;
  pending: boolean;
  pfc: string | null;
}

// Applies a Plaid "modified" transaction event in place — the fix for a
// confirmed data-loss bug (2026-07-29, owner-reported): the previous
// delete+reinsert path wiped txn_class/category_id on every modified event,
// which Plaid sends routinely (pending→settled is the common case), so any
// manual move (recategorize, move to Savings, dispute) silently reverted on
// the next sync. classifyTransactions then machine-reclassified the freshly
// NULLed row, completing the wipe.
//
// UPDATE touches ONLY Plaid-owned fields: date, name, amount, pending, pfc.
// txn_class and category_id are never in this statement, so a user's manual
// classification survives every future "modified" event unconditionally.
//
// merchant is the one field Plaid and the user both write, so it needs a
// rule: fill it ONLY when the stored value is NULL (COALESCE(merchant, ?) —
// first enrichment wins). Tradeoff, deliberate: a later Plaid merchant-name
// improvement for an already-enriched txn is forgone, in exchange for a
// user's rename (or the original auto-enrichment) never being clobbered by
// a routine sync.
export function applyModifiedTxn(d: Database.Database, accountId: number, fields: ModifiedTxnFields): void {
  const existing = d
    .prepare(`SELECT id FROM transactions WHERE plaid_txn_id = ?`)
    .get(fields.plaidTxnId) as { id: number } | undefined;

  if (!existing) {
    // Edge case: Plaid sent "modified" for a txn we never saw as "added"
    // (e.g. a prior sync page was interrupted) — nothing to update, so fall
    // back to a fresh insert exactly like the added-txn path.
    d.prepare(
      `INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, pending, pfc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plaid_txn_id) DO NOTHING`,
    ).run(accountId, fields.plaidTxnId, fields.date, fields.name, fields.merchant, fields.amount,
      fields.pending ? 1 : 0, fields.pfc);
    return;
  }

  d.prepare(
    `UPDATE transactions
     SET date = ?, name = ?, amount = ?, pending = ?, pfc = ?,
         merchant = COALESCE(merchant, ?)
     WHERE id = ?`,
  ).run(fields.date, fields.name, fields.amount, fields.pending ? 1 : 0, fields.pfc, fields.merchant, existing.id);
}
