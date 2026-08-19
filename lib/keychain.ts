import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// macOS: secrets live in the Keychain only — never in env files, never on disk.
// Linux/Docker has no Keychain, so it falls back to a chmod-600 JSON file in
// the same directory the DB already lives in (one volume mount covers both).
// This is a real, deliberate weaker-than-Keychain tradeoff (plaintext-on-disk
// vs OS-encrypted-at-rest) — but it's parity with how every other self-hosted
// finance app in this space stores secrets, and it's Linux-only: the macOS
// path below is byte-for-byte unchanged, so the real instance is unaffected.
// Services: finance-plaid-client-id · finance-plaid-secret · finance-db-key · finance-pin-hash
const ACCOUNT = process.env.USER ?? "alena";
const cache = new Map<string, string | null>();
const IS_MACOS = platform() === "darwin";

// Demo mode gets its OWN keychain namespace (finance-demo-*): separate PIN,
// separate DB key. Nothing demo can unlock or decrypt the real database.
const DEMO = process.env.FT_DEMO === "1";
const mapService = (service: string) =>
  DEMO && service.startsWith("finance-") ? `finance-demo-${service.slice("finance-".length)}` : service;

const STORE_PATH = path.join(homedir(), "FinanceTracker", "secrets.local.json");

function readStore(): Record<string, string> {
  if (!existsSync(STORE_PATH)) return {};
  return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Record<string, string>;
}

function writeStore(store: Record<string, string>): void {
  mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  chmodSync(STORE_PATH, 0o600);
}

// finance-plaid-client-id -> FINANCE_PLAID_CLIENT_ID — lets a Docker Compose
// user supply Plaid keys via env instead of the app's own "set" flow. Read
// path only: env always wins over the file store when both are present.
const envVarName = (service: string) => service.toUpperCase().replace(/-/g, "_");

export function keychainGet(rawService: string): string | null {
  const service = mapService(rawService);
  if (cache.has(service)) return cache.get(service)!;

  let out: string | null;
  if (IS_MACOS) {
    try {
      out = execFileSync(
        "security",
        ["find-generic-password", "-a", ACCOUNT, "-s", service, "-w"],
        { encoding: "utf8" },
      ).trim();
    } catch {
      out = null;
    }
  } else {
    out = readStore()[service] ?? null;
  }

  const fromEnv = process.env[envVarName(service)];
  if (fromEnv) out = fromEnv;

  // do NOT cache misses — a key added later must be picked up on the next
  // call without a process restart (audit P2)
  if (out === null) return null;
  cache.set(service, out);
  return out;
}

export function keychainSet(rawService: string, value: string): void {
  const service = mapService(rawService);
  if (IS_MACOS) {
    // -U updates in place if the item already exists
    execFileSync("security", [
      "add-generic-password", "-a", ACCOUNT, "-s", service, "-w", value, "-U",
    ]);
  } else {
    const store = readStore();
    store[service] = value;
    writeStore(store);
  }
  cache.set(service, value);
}

/** DB encryption key — generated once, stored in Keychain, never on disk. */
export function dbKey(): string {
  let key = keychainGet("finance-db-key");
  if (!key) {
    key = crypto.randomBytes(32).toString("hex");
    keychainSet("finance-db-key", key);
  }
  return key;
}

export function plaidCreds(): { clientId: string; secret: string } | null {
  const clientId = keychainGet("finance-plaid-client-id");
  const secret = keychainGet("finance-plaid-secret");
  return clientId && secret ? { clientId, secret } : null;
}
