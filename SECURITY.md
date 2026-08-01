# Security & Data Flow

Plutus handles bank data, so this page states exactly where that data lives, what
leaves your machine, and what protects it. Everything below is verifiable in the
source files named alongside each claim.

## The short version

There is no Plutus server. Nobody hosts anything for you, there is no account to
create, and no telemetry or analytics of any kind is collected. The app runs on
your machine, talks to Plaid with **your** API keys, and writes to an encrypted
SQLite file in your home directory.

## Where your data lives

| Thing | Location | Protection |
|---|---|---|
| Balances, transactions, accounts | `~/FinanceTracker/finance.db` | SQLCipher-encrypted, file mode `600` |
| Database encryption key | macOS Keychain (`finance-db-key`) | Never written to disk or any env file |
| Plaid client ID + secret | macOS Keychain (`finance-plaid-*`) | Never written to disk or any env file |
| PIN | macOS Keychain (`finance-pin-hash`), as a scrypt hash + salt | Never stored in the database |
| Plaid access tokens | In the encrypted database | Read-only scope; cannot move money |

The database is opened with `PRAGMA cipher='sqlcipher'` and a 32-byte random key
generated on first run ([lib/db.ts](lib/db.ts), [lib/keychain.ts](lib/keychain.ts)).
Nothing under `~/FinanceTracker/` is ever tracked by git — `.gitignore` blocks
`*.db`, `*.sqlite*`, `.env*`, and `seed.local.json` as a backstop.

## What leaves your machine

Exactly two destinations, both with credentials you supply:

1. **Plaid** (`production.plaid.com` or `sandbox.plaid.com`) — balance and
   transaction sync, using your own client ID and secret. Your bank credentials
   are typed into Plaid Link's own window; Plutus never sees or stores them. What
   Plutus receives and keeps is a read-only access token.
2. **Anthropic API** — *optional*, only if you configure a key and run
   `categorize-ai`. It is sent **merchant name strings only** — no amounts, no
   dates, no balances, no account identifiers ([lib/ai-categorize.ts](lib/ai-categorize.ts)).
   Without a key the command is a clean no-op and rule-based categorization still
   works.

That is the complete list. No crash reporting, no usage stats, no update pings.

## Network exposure

The server binds `127.0.0.1` (`package.json` `dev`/`start`). As a backstop against
ever being started unbound, [middleware.ts](middleware.ts) rejects any request
whose `Host` is not `127.0.0.1` or `localhost` with a `403`. There is no LAN or
public listener; remote access is not a supported configuration.

Every response carries a self-only Content-Security-Policy (the only external
origins allowed are the `cdn.plaid.com` script and iframe that Plaid Link
requires), plus `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
`Permissions-Policy` denying camera, microphone, geolocation, and payment.

## Authentication

A 6-digit PIN gates every data route ([lib/auth.ts](lib/auth.ts)):

- Stored as `scrypt(pin, salt)` in the Keychain, compared with
  `crypto.timingSafeEqual`.
- 15-minute rolling auto-lock; the session cookie is `httpOnly`, `SameSite=Strict`,
  and HMAC-signed.
- The session signing key is HKDF-derived from the database key with a distinct
  info string, so a leak of one does not reveal the other.
- 5 wrong attempts trigger a 60-second cooldown. The attempt counter is persisted
  in the Keychain rather than process memory, so restarting the app does **not**
  reset it.
- Before a PIN exists there is no valid session, so data routes return `401` —
  a fresh install is not briefly wide open.

## CSRF

Every state-changing request (anything but `GET`/`HEAD`/`OPTIONS`) must carry an
`Origin` header resolving to `127.0.0.1` or `localhost`. A **missing** `Origin` is
rejected too, not waved through ([middleware.ts](middleware.ts)).

## Error handling

Route handlers are wrapped so an uncaught throw returns a generic
`{"error":"server-error"}` with status 500. Stack traces and raw error text are
logged locally and never sent to the client.

## Supply chain

- [gitleaks](.github/workflows/gitleaks.yml) scans every push and pull request for
  committed secrets.
- Dependencies are pinned via `pnpm-lock.yaml`.
- One dependency, `xlsx` (SheetJS), installs from the vendor's own CDN tarball
  rather than npm. This is the distribution channel SheetJS itself directs users
  to; the npm-registry package is no longer the maintained one. It is used only by
  `scripts/import-sheet.ts` for one-time spreadsheet import.

## Demo mode

`FT_DEMO=1` runs against a separate `~/FinanceTracker/demo.db` seeded with fake
data from `lib/seed-config.ts`, under its own Keychain namespace
(`finance-demo-*`) with a separate PIN and separate encryption key. Nothing in
demo mode can unlock or decrypt a real database. Use it to explore the app or to
develop against.

## Known limitations

- **macOS only right now.** Secrets depend on the Keychain. A cross-platform
  `.env` secrets path and a Docker image are the next milestone.
- **Disk encryption is your job.** Plutus encrypts its database, but if your
  machine's disk is unencrypted and unlocked, the Keychain-held key is reachable
  by anything running as you. Turn on FileVault.
- **Not audited by a third party.** The security work described here is the
  author's own, reviewed in-repo. Read the source; it is about 7,500 lines.

## Reporting a vulnerability

Open a GitHub security advisory on the repository, or a regular issue if the
problem is not sensitive. Please do not include real financial data in either.
