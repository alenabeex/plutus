import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db, snapshotNetworth } from "@/lib/db";
import { plaidCreds } from "@/lib/keychain";
import { getPlaidClient } from "@/lib/plaid";
import type { ConnectionsData } from "@/lib/types";

export const runtime = "nodejs";

const ITEMS_TOTAL = 10; // Plaid free tier limit shown in mockup

const SECURITY_STRINGS = [
  'Runs on <b>127.0.0.1 only</b> — unreachable from network',
  "Database encrypted (SQLCipher / AES-256)",
  'Keys in <b>macOS Keychain</b>, never on disk',
  "FileVault full-disk encryption beneath it all",
  "Plaid tokens are <b>read-only</b> — can't move money",
  "No third-party calls except Plaid · no analytics",
  "PIN lock · auto-lock after 15 min",
];

function buildConnectionsData(d: ReturnType<typeof db>): ConnectionsData {
  // Check if any Plaid items are linked
  const items = d
    .prepare(`SELECT id, institution, status, last_synced, logo FROM items`)
    .all() as { id: number; institution: string; status: string; last_synced: string | null; logo: string | null }[];

  let institutions: ConnectionsData["institutions"];

  if (items.length > 0) {
    // Real linked items
    institutions = items.map((item) => {
      // Get account names for sub
      const accts = d
        .prepare(`SELECT name FROM accounts WHERE item_id = ? AND active = 1 ORDER BY id ASC`)
        .all(item.id) as { name: string }[];
      const sub = accts.map((a) => a.name).join(" · ");
      const code = item.institution.slice(0, 2).toUpperCase();
      // Traffic-light health: red = needs re-auth, yellow = never synced or
      // last sync older than 36h (a missed daily 08:00 run + slack), green
      // otherwise. Label shows the date, not just a time — "5:00 PM" alone
      // can't distinguish today's sync from last Tuesday's.
      const syncedAt = item.last_synced ? new Date(item.last_synced) : null;
      const ageMs = syncedAt ? Date.now() - syncedAt.getTime() : Infinity;
      const health: "good" | "stale" | "error" =
        item.status === "reauth" ? "error" : ageMs > 36 * 60 * 60 * 1000 ? "stale" : "good";
      return {
        code,
        name: item.institution,
        sub,
        status: (item.status === "reauth" ? "reauth" : "healthy") as "healthy" | "reauth",
        last: syncedAt
          ? syncedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "Never synced",
        health,
        logo: item.logo,
      };
    });
  } else {
    // No Plaid items linked yet — derive placeholder rows from distinct institutions
    // from non-manual accounts (seeded accounts with institution filled in)
    const instRows = d
      .prepare(
        `SELECT DISTINCT institution, code,
          GROUP_CONCAT(name, ' · ') as sub
         FROM accounts
         WHERE kind != 'manual' AND institution != '' AND active = 1
         GROUP BY institution
         ORDER BY institution ASC`
      )
      .all() as { institution: string; code: string; sub: string }[];

    // Placeholder rows aren't real Plaid connections — amber, "Not linked".
    institutions = instRows.map((r) => ({
      code: r.code,
      name: r.institution,
      sub: r.sub,
      status: "healthy" as const,
      last: "Not linked",
      health: "stale" as const,
    }));
  }

  const itemsUsed = items.length;

  // Manual assets with latest values
  const manualRows = d
    .prepare(
      `SELECT ma.id, ma.label,
        (SELECT value FROM manual_asset_values mav WHERE mav.manual_asset_id = ma.id ORDER BY date DESC LIMIT 1) AS value
       FROM manual_assets ma
       ORDER BY ma.id ASC`
    )
    .all() as { id: number; label: string; value: number }[];

  const manualAssets = manualRows.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.value ?? 0,
  }));

  return {
    institutions,
    itemsUsed,
    itemsTotal: ITEMS_TOTAL,
    manualAssets,
    security: SECURITY_STRINGS,
    plaidConfigured: plaidCreds() !== null,
  };
}

export async function GET(req: NextRequest) {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  return withRefreshedSession(req, buildConnectionsData(db()));
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await req.json() as { label?: string; value?: number };

  if (
    typeof body.label !== "string" || !body.label.trim() ||
    typeof body.value !== "number" || !Number.isFinite(body.value)
  ) {
    return NextResponse.json({ error: "label and value are required" }, { status: 400 });
  }

  const d = db();
  const today = new Date().toISOString().slice(0, 10);
  const label = body.label.trim();
  const code = label.slice(0, 2).toUpperCase();

  const acctId = d
    .prepare(
      `INSERT INTO accounts (code, name, institution, sub, kind, is_liability) VALUES (?, ?, '', '', 'manual', 0)`
    )
    .run(code, label).lastInsertRowid as number;

  d.prepare(`INSERT INTO balances (account_id, date, value) VALUES (?, ?, ?)`).run(
    acctId, today, body.value
  );

  const manualAssetId = d
    .prepare(`INSERT INTO manual_assets (account_id, label) VALUES (?, ?)`)
    .run(acctId, label).lastInsertRowid as number;

  d.prepare(
    `INSERT INTO manual_asset_values (manual_asset_id, date, value) VALUES (?, ?, ?)`
  ).run(manualAssetId, today, body.value);

  snapshotNetworth(d);

  return withRefreshedSession(req, buildConnectionsData(d));
});

// Remove an institution: deactivate its accounts (history stays in the DB,
// they just stop counting toward net worth) and drop any Plaid item rows.
export const DELETE = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await req.json() as { institution?: string; manualAssetId?: number };
  const d = db();

  // Remove a manual asset: drop its value history, the asset row, and its
  // backing account (manual accounts only ever exist for manual assets).
  if (typeof body.manualAssetId === "number") {
    const asset = d
      .prepare(`SELECT id, account_id FROM manual_assets WHERE id = ?`)
      .get(body.manualAssetId) as { id: number; account_id: number } | undefined;

    if (!asset) {
      return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });
    }

    d.prepare(`DELETE FROM manual_asset_values WHERE manual_asset_id = ?`).run(asset.id);
    d.prepare(`DELETE FROM manual_assets WHERE id = ?`).run(asset.id);
    d.prepare(`DELETE FROM balances WHERE account_id = ?`).run(asset.account_id);
    d.prepare(`DELETE FROM accounts WHERE id = ? AND kind = 'manual'`).run(asset.account_id);

    snapshotNetworth(d);
    return withRefreshedSession(req, buildConnectionsData(d));
  }

  if (typeof body.institution !== "string" || !body.institution.trim()) {
    return NextResponse.json({ error: "institution or manualAssetId is required" }, { status: 400 });
  }

  const name = body.institution.trim();

  // Revoke at Plaid too, best-effort — before the local delete drops the
  // tokens. Without this the access token stays live at Plaid after the app
  // forgets the connection: it keeps counting toward the item limit, keeps
  // billing, and leaves a stale grant in the bank's security center. A
  // revoke failure never blocks the local remove — the owner asked for the
  // connection to be gone, and a dead token at Plaid is Plaid's problem.
  const client = getPlaidClient();
  if (client) {
    const tokens = d
      .prepare(`SELECT access_token FROM items WHERE institution = ?`)
      .all(name) as { access_token: string }[];
    for (const t of tokens) {
      try {
        await client.itemRemove({ access_token: t.access_token });
      } catch (e) {
        console.error("plaid itemRemove failed (continuing local remove):", e);
      }
    }
  }

  // foreign_keys is ON (driver default), so items can't be deleted while
  // accounts still reference them — the old handler threw
  // SQLITE_CONSTRAINT_FOREIGNKEY here on every Plaid-linked institution and
  // the remove silently never happened. Detach accounts (item_id = NULL) as
  // they're deactivated, THEN delete the item rows. Matching by item_id as
  // well as institution string also catches accounts whose stored
  // institution drifted from the item's (older links, sheet imports).
  // One transaction: either the connection and its accounts all go, or
  // nothing does.
  const { deactivated, itemsDeleted } = d.transaction(() => {
    const deactivated = d
      .prepare(
        `UPDATE accounts SET active = 0, item_id = NULL
         WHERE kind != 'manual'
           AND (institution = ?
                OR item_id IN (SELECT id FROM items WHERE institution = ?))`,
      )
      .run(name, name).changes;
    const itemsDeleted = d.prepare(`DELETE FROM items WHERE institution = ?`).run(name).changes;

    // Sweep orphans left by earlier partial removals.
    d.prepare(
      `UPDATE accounts SET active = 0, item_id = NULL
       WHERE active = 1 AND item_id IS NOT NULL
         AND item_id NOT IN (SELECT id FROM items)`,
    ).run();

    return { deactivated, itemsDeleted };
  })();

  if (deactivated === 0 && itemsDeleted === 0) {
    return NextResponse.json({ error: "Institution not found" }, { status: 404 });
  }

  snapshotNetworth(d);
  return withRefreshedSession(req, buildConnectionsData(d));
});

export const PUT = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await req.json() as { manualAssetId: number; value: number };

  if (typeof body.manualAssetId !== "number" || typeof body.value !== "number") {
    return NextResponse.json({ error: "manualAssetId and value are required" }, { status: 400 });
  }

  const d = db();
  const today = new Date().toISOString().slice(0, 10);

  // Get the manual asset to find its linked account
  const asset = d
    .prepare(`SELECT id, account_id FROM manual_assets WHERE id = ?`)
    .get(body.manualAssetId) as { id: number; account_id: number } | undefined;

  if (!asset) {
    return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });
  }

  // Insert new manual_asset_values row
  d.prepare(
    `INSERT INTO manual_asset_values (manual_asset_id, date, value) VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(body.manualAssetId, today, body.value);

  // Insert a balances row for the linked account
  d.prepare(
    `INSERT INTO balances (account_id, date, value) VALUES (?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value`
  ).run(asset.account_id, today, body.value);

  // Snapshot net worth
  snapshotNetworth(d);

  return withRefreshedSession(req, { ok: true });
});
