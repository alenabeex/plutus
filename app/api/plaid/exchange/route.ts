import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { getPlaidClient, fetchBranding } from "@/lib/plaid";
import { db, snapshotNetworth } from "@/lib/db";

export const runtime = "nodejs";

// Map Plaid account type strings to our schema's kind values.
function plaidTypeToKind(type: string): "cash" | "investment" | "credit" | "manual" {
  switch (type) {
    case "depository": return "cash";
    case "investment": return "investment";
    case "credit": return "credit";
    default: return "cash";
  }
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const client = getPlaidClient();
  if (!client) {
    return NextResponse.json(
      {
        error: "plaid-not-configured",
        hint: "add finance-plaid-client-id / finance-plaid-secret to Keychain",
      },
      { status: 503 },
    );
  }

  const body = await req.json() as { public_token: string; institution: string; institution_id?: string | null };
  const { public_token, institution, institution_id } = body;

  if (!public_token || !institution) {
    return NextResponse.json({ error: "missing public_token or institution" }, { status: 400 });
  }

  // Exchange public token for access token.
  const exchangeRes = await client.itemPublicTokenExchange({ public_token });
  const { access_token, item_id: plaid_item_id } = exchangeRes.data;

  const d = db();
  const today = new Date().toISOString().slice(0, 10);

  // Store item row.
  const itemInsert = d.prepare(`
    INSERT INTO items (plaid_item_id, institution, access_token, status, last_synced)
    VALUES (?, ?, ?, 'healthy', ?)
    ON CONFLICT(plaid_item_id) DO UPDATE SET
      access_token = excluded.access_token,
      institution  = excluded.institution,
      status       = 'healthy',
      last_synced  = excluded.last_synced
  `);
  itemInsert.run(plaid_item_id, institution, access_token, today);

  if (institution_id) {
    const { logo, primaryColor } = await fetchBranding(client, institution_id);
    d.prepare(`UPDATE items SET institution_id = ?, logo = ?, primary_color = ? WHERE plaid_item_id = ?`)
      .run(institution_id, logo, primaryColor, plaid_item_id);
  }

  const item = d
    .prepare(`SELECT id FROM items WHERE plaid_item_id = ?`)
    .get(plaid_item_id) as { id: number };

  // Derive a 2-letter code from institution name.
  const code = institution.slice(0, 2).toUpperCase();

  // Fetch accounts and upsert.
  const accountsRes = await client.accountsGet({ access_token });
  const accounts = accountsRes.data.accounts;

  const upsertAccount = d.prepare(`
    INSERT INTO accounts (item_id, plaid_account_id, code, name, institution, sub, kind, is_liability, mask)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plaid_account_id) DO UPDATE SET
      name        = excluded.name,
      institution = excluded.institution,
      kind        = excluded.kind,
      is_liability = excluded.is_liability,
      mask        = excluded.mask
  `);

  const upsertBalance = d.prepare(`
    INSERT INTO balances (account_id, date, value) VALUES (?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value
  `);

  let accountCount = 0;
  for (const acct of accounts) {
    const kind = plaidTypeToKind(acct.type);
    const isLiability = kind === "credit" ? 1 : 0;
    // Credit balances stored as negative.
    const rawValue = acct.balances.current ?? 0;
    const value = isLiability ? -Math.abs(rawValue) : rawValue;

    // nickname is deliberately absent from the upsert — a re-link must never
    // clobber a name the owner chose.
    upsertAccount.run(
      item.id,
      acct.account_id,
      code,
      acct.name,
      institution,
      acct.official_name ?? acct.name,
      kind,
      isLiability,
      acct.mask ?? null,
    );

    const row = d
      .prepare(`SELECT id FROM accounts WHERE plaid_account_id = ?`)
      .get(acct.account_id) as { id: number };

    upsertBalance.run(row.id, today, value);
    accountCount++;
  }

  snapshotNetworth(d);

  return withRefreshedSession(req, { ok: true, accounts: accountCount });
});
