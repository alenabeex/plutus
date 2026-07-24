import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

// Secrets live in the macOS Keychain only — never in env files, never on disk.
// Services: finance-plaid-client-id · finance-plaid-secret · finance-db-key · finance-pin-hash
const ACCOUNT = process.env.USER ?? "alena";
const cache = new Map<string, string | null>();

// Demo mode gets its OWN keychain namespace (finance-demo-*): separate PIN,
// separate DB key. Nothing demo can unlock or decrypt the real database.
const DEMO = process.env.FT_DEMO === "1";
const mapService = (service: string) =>
  DEMO && service.startsWith("finance-") ? `finance-demo-${service.slice("finance-".length)}` : service;

export function keychainGet(rawService: string): string | null {
  const service = mapService(rawService);
  if (cache.has(service)) return cache.get(service)!;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-a", ACCOUNT, "-s", service, "-w"],
      { encoding: "utf8" },
    ).trim();
    cache.set(service, out);
    return out;
  } catch {
    // do NOT cache misses — a key added later must be picked up on the
    // next call without a process restart (audit P2)
    return null;
  }
}

export function keychainSet(rawService: string, value: string): void {
  const service = mapService(rawService);
  // -U updates in place if the item already exists
  execFileSync("security", [
    "add-generic-password", "-a", ACCOUNT, "-s", service, "-w", value, "-U",
  ]);
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
