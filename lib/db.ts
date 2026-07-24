import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { dbKey } from "./keychain";
import { DEMO_SEED, type SeedConfig } from "./seed-config";
import { gradeFor } from "./format";

// Data NEVER lives in the vault/git — ~/FinanceTracker/ only (plan §Decisions).
// FT_DEMO=1 → separate demo.db seeded with fake data; AI agents develop and
// verify against it so the real database never enters model context (AGENTS.md).
const DEMO = process.env.FT_DEMO === "1";
const DATA_DIR = path.join(homedir(), "FinanceTracker");
const DB_PATH = path.join(DATA_DIR, DEMO ? "demo.db" : "finance.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const fresh = !existsSync(DB_PATH);
  _db = new Database(DB_PATH);
  _db.pragma(`cipher='sqlcipher'`);
  // fail loud on a corrupted/edited Keychain entry instead of feeding a
  // malformed string into the PRAGMA (audit P3)
  const key = dbKey();
  if (!/^[0-9a-f]+$/i.test(key)) throw new Error("finance-db-key is not valid hex");
  _db.pragma(`key='${key}'`);
  _db.pragma("journal_mode = WAL");
  chmodSync(DB_PATH, 0o600);
  migrate(_db);
  if (fresh) seed(_db);
  return _db;
}

/* ============================================================
   Schema v1 — plan T1.3 table list, idempotent (second run = no-op)
   ============================================================ */
function migrate(d: Database.Database) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, plaid_item_id TEXT UNIQUE, institution TEXT,
    access_token TEXT, status TEXT DEFAULT 'healthy', last_synced TEXT, cursor TEXT
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, item_id INTEGER REFERENCES items(id),
    plaid_account_id TEXT UNIQUE, code TEXT, name TEXT NOT NULL, institution TEXT,
    sub TEXT DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('cash','investment','credit','manual')),
    is_liability INTEGER DEFAULT 0, active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS balances (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
    date TEXT NOT NULL, value REAL NOT NULL, UNIQUE(account_id, date)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id),
    plaid_txn_id TEXT UNIQUE, date TEXT, name TEXT, merchant TEXT,
    amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id),
    security_id INTEGER, quantity REAL, value REAL, as_of TEXT
  );
  CREATE TABLE IF NOT EXISTS securities (
    id INTEGER PRIMARY KEY, plaid_security_id TEXT UNIQUE, ticker TEXT, name TEXT
  );
  CREATE TABLE IF NOT EXISTS manual_assets (
    id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id),
    label TEXT, note TEXT
  );
  CREATE TABLE IF NOT EXISTS manual_asset_values (
    id INTEGER PRIMARY KEY, manual_asset_id INTEGER REFERENCES manual_assets(id),
    date TEXT NOT NULL, value REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS networth_snapshots (
    date TEXT PRIMARY KEY, assets REAL NOT NULL, liabilities REAL NOT NULL, total REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS budget_months (
    month TEXT PRIMARY KEY,            -- '2026-01'
    income_json TEXT NOT NULL DEFAULT '[]',
    tax_set_aside REAL DEFAULT 0,
    variable_json TEXT NOT NULL DEFAULT '[]',
    total_income REAL DEFAULT 0, total_fixed REAL DEFAULT 0, total_variable REAL DEFAULT 0,
    savings REAL DEFAULT 0, cash_pct REAL, cash_amt REAL, invested_pct REAL, invested_amt REAL,
    grade TEXT, closed INTEGER DEFAULT 0, source TEXT DEFAULT 'app'  -- 'sheet' for imported history
  );
  CREATE TABLE IF NOT EXISTS budget_fixed_items (
    id INTEGER PRIMARY KEY, month TEXT NOT NULL REFERENCES budget_months(month),
    label TEXT NOT NULL, amount REAL NOT NULL, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS budget_goals (
    id INTEGER PRIMARY KEY, month TEXT REFERENCES budget_months(month),
    label TEXT, target REAL, saved REAL, status TEXT
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS category_rules (
    id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, field TEXT DEFAULT 'merchant',
    category_id INTEGER REFERENCES categories(id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount REAL, day INTEGER,
    cadence TEXT DEFAULT 'monthly' CHECK(cadence IN ('monthly','annual')),
    kind TEXT DEFAULT 'subscription' CHECK(kind IN ('subscription','bill','fee')),
    renewal TEXT, approx INTEGER DEFAULT 0, status TEXT DEFAULT 'confirmed'
  );
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY, started TEXT, finished TEXT, ok INTEGER, detail TEXT
  );
  `);

  // v2 additive columns — idempotent (checked against table_info each start)
  const itemCols = new Set(
    (d.prepare(`PRAGMA table_info(items)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!itemCols.has("institution_id")) d.exec(`ALTER TABLE items ADD COLUMN institution_id TEXT`);
  if (!itemCols.has("logo")) d.exec(`ALTER TABLE items ADD COLUMN logo TEXT`);          // base64 152×152 PNG from Plaid
  if (!itemCols.has("primary_color")) d.exec(`ALTER TABLE items ADD COLUMN primary_color TEXT`);

  const acctCols = new Set(
    (d.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[]).map((c) => c.name),
  );
  // Issuers reuse one generic name across products — two Chase cards both
  // arrive as "CREDIT CARD"/"Ultimate Rewards®". mask (last 4) is what
  // actually tells them apart; nickname lets the owner override.
  if (!acctCols.has("mask")) d.exec(`ALTER TABLE accounts ADD COLUMN mask TEXT`);
  if (!acctCols.has("nickname")) d.exec(`ALTER TABLE accounts ADD COLUMN nickname TEXT`);
}

/* ============================================================
   Seed — runs once on a fresh database.
   Config resolution: ~/FinanceTracker/seed.local.json (real data,
   outside any repo) → DEMO_SEED (fake, publishable) as fallback.
   Totals are computed from the arrays — a config can't disagree
   with itself. No fabricated history: the net-worth graph accrues
   from day 1.
   ============================================================ */
const SEED_LOCAL_PATH = path.join(DATA_DIR, "seed.local.json");

function loadSeedConfig(): SeedConfig {
  // demo mode never touches the real seed — fake data only (AGENTS.md rule 2)
  if (!DEMO && existsSync(SEED_LOCAL_PATH)) {
    return JSON.parse(readFileSync(SEED_LOCAL_PATH, "utf8")) as SeedConfig;
  }
  return DEMO_SEED;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function seed(d: Database.Database) {
  const cfg = loadSeedConfig();
  const today = new Date().toISOString().slice(0, 10);

  const insAcct = d.prepare(
    `INSERT INTO accounts (code,name,institution,sub,kind,is_liability,mask) VALUES (?,?,?,?,?,?,?)`,
  );
  const insBal = d.prepare(`INSERT INTO balances (account_id,date,value) VALUES (?,?,?)`);
  const insMan = d.prepare(`INSERT INTO manual_assets (account_id,label) VALUES (?,?)`);
  const insManVal = d.prepare(`INSERT INTO manual_asset_values (manual_asset_id,date,value) VALUES (?,?,?)`);

  for (const a of cfg.accounts) {
    const id = insAcct.run(a.code, a.name, a.institution, a.sub, a.kind, a.is_liability, a.mask ?? null)
      .lastInsertRowid as number;
    insBal.run(id, today, a.value);
    if (a.manualLabel) {
      const mid = insMan.run(id, a.manualLabel).lastInsertRowid as number;
      insManVal.run(mid, today, a.value);
    }
  }

  const insCat = d.prepare(`INSERT INTO categories (name,sort) VALUES (?,?)`);
  cfg.categories.forEach((c, i) => insCat.run(c, i));

  const insMonth = d.prepare(
    `INSERT INTO budget_months (month,income_json,tax_set_aside,variable_json,total_income,total_fixed,total_variable,savings,cash_pct,cash_amt,invested_pct,invested_amt,grade,source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insFix = d.prepare(
    `INSERT INTO budget_fixed_items (month,label,amount,sort) VALUES (?,?,?,?)`,
  );
  for (const m of cfg.budgetMonths) {
    const totalIncome = round2(m.income.reduce((s, i) => s + i.value, 0));
    const totalFixed = round2(m.fixed.reduce((s, i) => s + i.value, 0));
    const totalVariable = round2(m.variable.reduce((s, i) => s + i.value, 0));
    const savings = round2(totalIncome - totalFixed - totalVariable);
    insMonth.run(
      m.month, JSON.stringify(m.income), m.taxSetAside, JSON.stringify(m.variable),
      totalIncome, totalFixed, totalVariable, savings,
      m.cashPct, m.cashAmt, m.investedPct, m.investedAmt,
      gradeFor(totalIncome, totalVariable, savings).grade, m.source,
    );
    m.fixed.forEach((f, i) => insFix.run(m.month, f.label, f.value, i));
  }

  const insSub = d.prepare(
    `INSERT INTO subscriptions (name,amount,day,cadence,kind,renewal,approx) VALUES (?,?,?,?,?,?,?)`,
  );
  for (const s of cfg.subscriptions) {
    insSub.run(s.name, s.amount, s.day, s.cadence, s.kind, s.renewal, s.approx);
  }

  snapshotNetworth(d);
}

/* ============================================================
   Queries used by the API routes
   ============================================================ */
export function latestBalances(d = db()) {
  return d
    .prepare(
      `SELECT a.id, a.code, a.name, a.institution, a.sub, a.kind, a.is_liability,
              a.mask, a.nickname,
              (SELECT value FROM balances b WHERE b.account_id = a.id ORDER BY date DESC LIMIT 1) AS value,
              (SELECT logo FROM items i WHERE i.id = a.item_id) AS logo
       FROM accounts a WHERE a.active = 1`,
    )
    .all() as {
    id: number; code: string; name: string; institution: string; sub: string;
    kind: string; is_liability: number; value: number; logo: string | null;
    mask: string | null; nickname: string | null;
  }[];
}

export function snapshotNetworth(d = db()) {
  const rows = latestBalances(d);
  const assets = rows.filter((r) => !r.is_liability).reduce((s, r) => s + (r.value ?? 0), 0);
  const liabilities = rows.filter((r) => r.is_liability).reduce((s, r) => s + Math.abs(r.value ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  d.prepare(
    `INSERT INTO networth_snapshots (date,assets,liabilities,total) VALUES (?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET assets=excluded.assets, liabilities=excluded.liabilities, total=excluded.total`,
  ).run(today, assets, liabilities, assets - liabilities);
  return { date: today, assets, liabilities, total: assets - liabilities };
}
