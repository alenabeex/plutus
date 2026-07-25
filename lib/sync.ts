import type Database from "better-sqlite3-multiple-ciphers";
import { db, snapshotNetworth } from "./db";
import { deriveAll } from "./derive";
import { createMonth } from "./budget-ops";
import { getPlaidClient, fetchBranding } from "./plaid";
import type { PlaidApi } from "plaid";

// Shared Plaid sync core — used by both app/api/plaid/sync/route.ts (HTTP)
// and scripts/cli.ts (`cli sync`, no-HTTP). Keep this the single source of
// truth for the per-item balance/transactions/holdings sync so the two
// callers never drift.

export type SyncOutcome =
  | { configured: false }
  | { configured: true; synced: number; errors: string[] };

// Branding is fetched at link time, but the logo/institution_id columns were
// added to `items` after the first connections existed — those rows have no
// logo and nothing else backfills them, so they'd render as initials forever.
// Fill any gap here: only rows still missing a logo are queried, so once an
// institution has one this costs zero Plaid calls.
async function backfillBranding(client: PlaidApi, d: Database.Database) {
  const stale = d
    .prepare(
      `SELECT id, access_token, institution_id FROM items
       WHERE logo IS NULL AND status != 'removed'`,
    )
    .all() as { id: number; access_token: string; institution_id: string | null }[];

  for (const item of stale) {
    try {
      // Pre-migration rows can be missing institution_id too — Plaid can map
      // the access token back to its institution.
      let instId = item.institution_id;
      if (!instId) {
        const res = await client.itemGet({ access_token: item.access_token });
        instId = res.data.item.institution_id ?? null;
        if (!instId) continue;
      }

      const { logo, primaryColor } = await fetchBranding(client, instId);
      // COALESCE so an institution that publishes no logo doesn't wipe a
      // primary_color we already hold.
      d.prepare(
        `UPDATE items SET institution_id = ?,
                          logo = COALESCE(?, logo),
                          primary_color = COALESCE(?, primary_color)
         WHERE id = ?`,
      ).run(instId, logo, primaryColor, item.id);
    } catch (err) {
      // Branding is cosmetic — never let it break a sync.
      console.error(`branding backfill failed for item ${item.id}:`, err);
    }
  }
}

export async function runPlaidSync(dArg?: Database.Database): Promise<SyncOutcome> {
  const client = getPlaidClient();
  if (!client) return { configured: false };

  // Resolved lazily (not as a default param) so a "not configured" call
  // never opens/creates the local db — matches the original route's order.
  const d = dArg ?? db();

  const today = new Date().toISOString().slice(0, 10);
  const started = new Date().toISOString();

  await backfillBranding(client, d);

  const items = d
    .prepare(`SELECT id, plaid_item_id, access_token, cursor FROM items WHERE status != 'removed'`)
    .all() as { id: number; plaid_item_id: string; access_token: string; cursor: string | null }[];

  let synced = 0;
  const errors: string[] = [];

  const upsertBalance = d.prepare(`
    INSERT INTO balances (account_id, date, value) VALUES (?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value
  `);

  const upsertTransaction = d.prepare(`
    INSERT INTO transactions (account_id, plaid_txn_id, date, name, merchant, amount, pending)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plaid_txn_id) DO NOTHING
  `);

  const removeTransaction = d.prepare(`
    DELETE FROM transactions WHERE plaid_txn_id = ?
  `);

  const upsertHolding = d.prepare(`
    INSERT INTO holdings (account_id, security_id, quantity, value, as_of)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);

  const upsertSecurity = d.prepare(`
    INSERT INTO securities (plaid_security_id, ticker, name)
    VALUES (?, ?, ?)
    ON CONFLICT(plaid_security_id) DO UPDATE SET
      ticker = excluded.ticker,
      name   = excluded.name
  `);

  // hoisted once — was re-prepared inside every loop iteration (audit P2)
  const getAccountByPlaidId = d.prepare(
    `SELECT id, is_liability FROM accounts WHERE plaid_account_id = ?`,
  );

  for (const item of items) {
    try {
      const { access_token } = item;

      // --- Balances ---
      const balRes = await client.accountsBalanceGet({ access_token });
      for (const acct of balRes.data.accounts) {
        const row = getAccountByPlaidId
          .get(acct.account_id) as { id: number; is_liability: number } | undefined;
        if (!row) continue;
        const rawValue = acct.balances.current ?? 0;
        const value = row.is_liability ? -Math.abs(rawValue) : rawValue;
        upsertBalance.run(row.id, today, value);
      }

      // --- Transactions (incremental sync with cursor) ---
      let cursor: string | undefined = item.cursor ?? undefined;
      let hasMore = true;

      while (hasMore) {
        const txnRes = await client.transactionsSync({
          access_token,
          cursor,
        });
        const { added, modified, removed, next_cursor } = txnRes.data;

        for (const txn of added) {
          const row = getAccountByPlaidId
            .get(txn.account_id) as { id: number } | undefined;
          if (!row) continue;
          // amount in Plaid: positive = debit (money out), negative = credit.
          // Store as-is; the budget view handles sign convention.
          upsertTransaction.run(
            row.id,
            txn.transaction_id,
            txn.date,
            txn.name,
            txn.merchant_name ?? txn.name,
            txn.amount,
            txn.pending ? 1 : 0,
          );
        }

        for (const txn of modified) {
          const row = getAccountByPlaidId
            .get(txn.account_id) as { id: number } | undefined;
          if (!row) continue;
          // Update by removing and re-inserting (avoids full UPDATE column list).
          removeTransaction.run(txn.transaction_id);
          upsertTransaction.run(
            row.id,
            txn.transaction_id,
            txn.date,
            txn.name,
            txn.merchant_name ?? txn.name,
            txn.amount,
            txn.pending ? 1 : 0,
          );
        }

        for (const rm of removed) {
          removeTransaction.run(rm.transaction_id);
        }

        cursor = next_cursor;
        hasMore = txnRes.data.has_more;
      }

      // Persist updated cursor.
      d.prepare(`UPDATE items SET cursor = ?, last_synced = ? WHERE id = ?`).run(
        cursor ?? null,
        today,
        item.id,
      );

      // --- Investment holdings (best-effort) ---
      try {
        const invRes = await client.investmentsHoldingsGet({ access_token });
        const securityMap = new Map<string, number>();

        for (const sec of invRes.data.securities) {
          upsertSecurity.run(sec.security_id, sec.ticker_symbol ?? null, sec.name ?? null);
          const secRow = d
            .prepare(`SELECT id FROM securities WHERE plaid_security_id = ?`)
            .get(sec.security_id) as { id: number } | undefined;
          if (secRow) securityMap.set(sec.security_id, secRow.id);
        }

        for (const holding of invRes.data.holdings) {
          const acctRow = d
            .prepare(`SELECT id FROM accounts WHERE plaid_account_id = ?`)
            .get(holding.account_id) as { id: number } | undefined;
          if (!acctRow) continue;
          const secId = securityMap.get(holding.security_id);
          if (secId === undefined) continue;
          upsertHolding.run(
            acctRow.id,
            secId,
            holding.quantity,
            holding.institution_value ?? 0,
            today,
          );
        }
      } catch {
        // Investments not available on this item/plan — silently skip.
      }

      synced++;
    } catch (err: unknown) {
      // ITEM_LOGIN_REQUIRED → mark reauth, continue processing other items.
      const plaidErr = err as { response?: { data?: { error_code?: string } } };
      const code = plaidErr?.response?.data?.error_code;
      if (code === "ITEM_LOGIN_REQUIRED") {
        d.prepare(`UPDATE items SET status = 'reauth' WHERE id = ?`).run(item.id);
        errors.push(`item ${item.id}: ITEM_LOGIN_REQUIRED → status=reauth`);
      } else {
        // full error server-side only; generic text goes to the HTTP body
        // and sync_log.detail (audit P2 — no raw Plaid/Node internals out)
        console.error(`sync failed for item ${item.id}:`, err);
        errors.push(`item ${item.id}: sync-failed`);
      }
    }
  }

  snapshotNetworth(d);

  // auto-create the current month's cash-flow sheet on first sync of a new
  // month (copies fixed bills forward) — the + button becomes optional
  const nowM = new Date().toISOString().slice(0, 7);
  const hasMonths = (d.prepare(`SELECT COUNT(*) c FROM budget_months`).get() as { c: number }).c > 0;
  const nowExists = d.prepare(`SELECT month FROM budget_months WHERE month = ?`).get(nowM);
  if (hasMonths && !nowExists) {
    try { createMonth({ month: nowM, mode: "copy" }, d); } catch { /* racing create — fine */ }
  }

  // derivation pass: transactions → categories (Cash Flow) + recurring
  // detection (Subscriptions). Net worth derived above via balances.
  const derived = deriveAll(d);
  if (derived.categorized || derived.detected) {
    errors.length === 0 &&
      console.log(`derive: ${derived.categorized} categorized, ${derived.detected} recurring detected`);
  }

  const finished = new Date().toISOString();
  d.prepare(
    `INSERT INTO sync_log (started, finished, ok, detail) VALUES (?, ?, ?, ?)`,
  ).run(started, finished, errors.length === 0 ? 1 : 0, errors.join("; ") || null);

  return { configured: true, synced, errors };
}
