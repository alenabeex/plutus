# Plutus — app (formerly Finance Tracker)

Local-only net-worth + budget tracker. **Nothing leaves this machine.**

## Run

```bash
pnpm dev        # http://127.0.0.1:8420 — dev
pnpm build && pnpm start   # production, same address
```

First launch asks you to create a 6-digit PIN (stored as a hash in the macOS
Keychain). The app auto-locks after 15 minutes idle.

## Where things live

| Thing | Location |
|---|---|
| Code | this folder (in the vault, git-tracked) |
| Database (SQLCipher-encrypted) | `~/FinanceTracker/finance.db` — never in git |
| First-run seed (real data) | `~/FinanceTracker/seed.local.json` — never in git |
| Weekly backups (encrypted, keep 8) | `~/FinanceTracker/backups/` — launchd `com.alenayou.finance-backup`, Sun 23:30 (`pnpm backup` to run manually) |
| DB key, PIN hash, Plaid keys | macOS Keychain (`finance-*` services) |

**Seed model (open-source safe):** the committed code contains only fake demo
data (`lib/seed-config.ts`). On a fresh database the app seeds from
`~/FinanceTracker/seed.local.json` if present, else the demo. Budget totals and
grades are computed from the line items at seed time, so a config can't
disagree with itself. No real balance, income, merchant, or institution detail
exists anywhere in this folder.

## Connect Plaid (one-time)

1. Sign up at https://dashboard.plaid.com/signup (free Trial plan, 10 Items).
2. Put keys in the Keychain:
   ```bash
   security add-generic-password -a "$USER" -s finance-plaid-client-id -w '<client_id>'
   security add-generic-password -a "$USER" -s finance-plaid-secret -w '<secret>'
   # optional: 'sandbox' (default) or 'production'
   security add-generic-password -a "$USER" -s finance-plaid-env -w 'production'
   ```
3. In the app → Connections → **+ Link account**. Credentials go into Plaid's
   window only; the app stores a read-only access token in the encrypted DB.

## Import spreadsheet history

Export the Google Sheet (File → Download → .xlsx) to
`01_capture/raw/budget-history.xlsx`, then:

```bash
pnpm exec tsx scripts/import-sheet.ts "../../../../01_capture/raw/budget-history.xlsx" --dry-run   # inspect first
pnpm exec tsx scripts/import-sheet.ts "../../../../01_capture/raw/budget-history.xlsx"             # commit
```

`--dry-run` prints every matched/unmatched label and reconciles
income − fixed − variable against the sheet's savings to the cent.

## Security posture

- Server binds `127.0.0.1` only; middleware 403s any non-localhost Host as a backstop.
- SQLCipher (AES-256) database, key generated on first run → Keychain, file `chmod 600`.
- PIN gate before any data renders; 5 wrong attempts → 60s cooldown; 15-min auto-lock.
- Plaid tokens are read-only — they cannot move money.
- No analytics, no third-party calls except Plaid.
- `.gitignore` blocks `*.db` and `.env*` as a second line of defense.
