import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db, snapshotNetworth } from "@/lib/db";
import { plaidCreds } from "@/lib/keychain";
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
      return {
        code,
        name: item.institution,
        sub,
        status: (item.status === "reauth" ? "reauth" : "healthy") as "healthy" | "reauth",
        last: item.last_synced
          ? new Date(item.last_synced).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "—",
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

    institutions = instRows.map((r) => ({
      code: r.code,
      name: r.institution,
      sub: r.sub,
      status: "healthy" as const,
      last: "—",
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

  const deactivated = d
    .prepare(`UPDATE accounts SET active = 0 WHERE institution = ? AND kind != 'manual'`)
    .run(name).changes;
  const itemsDeleted = d.prepare(`DELETE FROM items WHERE institution = ?`).run(name).changes;

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
