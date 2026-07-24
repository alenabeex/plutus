import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { keychainGet, keychainSet, dbKey } from "./keychain";

// PIN gate (plan T1.4): 6-digit PIN, scrypt hash in Keychain, 15-min rolling
// auto-lock, 5 wrong attempts → 60s cooldown. Data routes 401 until unlocked.
const SESSION_COOKIE = "ft_session";
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 1000;

// Brute-force state persists in the Keychain, not process memory — a restart
// must NOT reset the cooldown (audit P2). Stored as "attempts:cooldownUntil".
function readAttemptState(): { attempts: number; cooldownUntil: number } {
  const raw = keychainGet("finance-pin-attempts");
  if (!raw) return { attempts: 0, cooldownUntil: 0 };
  const [a, c] = raw.split(":");
  return { attempts: Number(a) || 0, cooldownUntil: Number(c) || 0 };
}
function writeAttemptState(attempts: number, cooldownUntil: number): void {
  keychainSet("finance-pin-attempts", `${attempts}:${cooldownUntil}`);
}

// Session-signing key is domain-separated from the DB key via HKDF (audit P2):
// a leak of one must not reveal the other. Derived once per process.
let _sessionKey: Buffer | null = null;
function sessionKey(): Buffer {
  if (_sessionKey) return _sessionKey;
  _sessionKey = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(dbKey(), "hex"), Buffer.alloc(0), "finance-session-hmac", 32),
  );
  return _sessionKey;
}
const hmac = (msg: string) =>
  crypto.createHmac("sha256", sessionKey()).update(msg).digest("hex");

export function pinIsSet(): boolean {
  return keychainGet("finance-pin-hash") !== null;
}

export function setPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be exactly 6 digits");
  if (pinIsSet()) throw new Error("PIN already set");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  keychainSet("finance-pin-hash", `${salt}:${hash}`);
}

export function verifyPin(pin: string): { ok: boolean; retryInMs?: number } {
  const now = Date.now();
  const { attempts, cooldownUntil } = readAttemptState();
  if (now < cooldownUntil) return { ok: false, retryInMs: cooldownUntil - now };
  const stored = keychainGet("finance-pin-hash");
  if (!stored) return { ok: false };
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(pin, salt, 32).toString("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
  if (!ok) {
    const next = attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      writeAttemptState(0, now + COOLDOWN_MS);
      return { ok: false, retryInMs: COOLDOWN_MS };
    }
    writeAttemptState(next, 0);
    return { ok: false };
  }
  writeAttemptState(0, 0);
  return { ok: true };
}

export function issueSession(res: NextResponse): void {
  const exp = Date.now() + SESSION_TTL_MS;
  res.cookies.set(SESSION_COOKIE, `${exp}.${hmac(String(exp))}`, {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: SESSION_TTL_MS / 1000,
  });
}

export function sessionValid(req: NextRequest): boolean {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = hmac(exp);
  return sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Guard for every data route. Returns a 401 response, or null if OK.
 *  A valid session is ALWAYS required — before a PIN exists there is no
 *  session, so data routes 401 (the /api/pin route is unguarded, so setup
 *  still works). This closes the pre-PIN "auth fully open" hole (audit P1). */
export function requireUnlocked(req: NextRequest): NextResponse | null {
  if (sessionValid(req)) return null;
  return NextResponse.json({ error: "locked" }, { status: 401 });
}

export function withRefreshedSession<T>(req: NextRequest, body: T): NextResponse {
  const res = NextResponse.json(body);
  if (sessionValid(req)) issueSession(res);
  return res;
}

/** Wrap a route handler so an uncaught throw returns a generic 500 instead of
 *  leaking a stack trace / raw error to the client (audit P1). */
export function withJsonErrors(
  handler: (req: NextRequest) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (e) {
      console.error("route error:", e);
      return NextResponse.json({ error: "server-error" }, { status: 500 });
    }
  };
}
