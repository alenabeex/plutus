// Weekly encrypted backup of finance.db → ~/FinanceTracker/backups/, keep 8.
// Run: pnpm backup   (launchd: com.alenayou.finance-backup, Sun 23:30)
// The copy is produced with `VACUUM INTO`, so it stays SQLCipher-encrypted
// with the same Keychain key. No plaintext ever touches disk.
import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, readdirSync, unlinkSync, statSync, copyFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Database from "better-sqlite3-multiple-ciphers";

const KEEP = 8;

if (process.env.FT_DEMO === "1") {
  console.log("FT_DEMO set — demo database is never backed up. Exiting.");
  process.exit(0);
}

const DATA_DIR = path.join(homedir(), "FinanceTracker");
const DB_PATH = path.join(DATA_DIR, "finance.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const key = execFileSync(
  "security",
  ["find-generic-password", "-a", process.env.USER ?? "alena", "-s", "finance-db-key", "-w"],
  { encoding: "utf8" },
).trim();

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const dest = path.join(BACKUP_DIR, `finance-${stamp}.db`);

// Copy strategy: the on-disk file IS the encrypted artifact. Checkpoint the
// WAL into the main file through a keyed connection, then byte-copy it.
// (VACUUM INTO / sqlcipher_export write plaintext or don't exist under
// SQLite3MultipleCiphers — learned the hard way, verified below either way.)
const db = new Database(DB_PATH, { readonly: false });
db.pragma(`cipher='sqlcipher'`);
db.pragma(`key='${key}'`);
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

// re-running on the same day replaces that day's backup
try { unlinkSync(dest); } catch { /* not there — fine */ }
copyFileSync(DB_PATH, dest);
chmodSync(dest, 0o600);

// paranoia: refuse to keep a backup that isn't actually encrypted
const header = readFileSync(dest).subarray(0, 15).toString("utf8");
if (header === "SQLite format 3") {
  unlinkSync(dest);
  throw new Error("backup came out PLAINTEXT — destroyed it; aborting");
}

// rotate: newest KEEP stay
const backups = readdirSync(BACKUP_DIR)
  .filter((f) => /^finance-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .reverse();
for (const old of backups.slice(KEEP)) {
  unlinkSync(path.join(BACKUP_DIR, old));
}

const size = Math.round(statSync(dest).size / 1024);
console.log(`backup ok: ${dest} (${size} KB) · ${Math.min(backups.length, KEEP)} kept`);
