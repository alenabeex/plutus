# Plutus — Activity Log

Running log of operations performed on this app repo: code, build, ops,
verification. Lives here (not in the Alena OS vault) because `app/` is its own
git repo — this log travels with the code.

**Scope:** anything inside `app/`. Work on vault-side project files
(`finance-tracker-plan.md`, wireframes, market research) belongs in the vault's
`00_system/activity.md` instead.

**Rule:** per `AGENTS.md` §3 — demo/placeholder numbers only. Never a real
balance, never a Keychain secret value, never a real institution's data.

Tags: `[GIT]` `[FILE]` `[CONFIG]` `[OPS]`
Format: `### YYYY-MM-DD` then one line per action with tag prefix.

---

### 2026-07-27 (later)

- `[FILE]` **Cash Flow read-only + Monarch layout shipped.** Spec docs/superpowers/specs/2026-07-27-cashflow-readonly-monarch-design.md, plan docs/superpowers/plans/2026-07-27-cashflow-readonly-monarch.md, executed subagent-per-task. 8 commits: vitest harness (d1ef58e), cashflowView TDD 6 tests (67d75f2), API read-only GET/CashflowData + PUT/POST deleted (67ce6ed), view rewrite — tiles/allocation bar/drill-down rows (ccc51df), typography onto product-designer type scale (5403b82), income-green/expenses-red tiles (0971329), BudgetData dropped (df8c470), row amounts color-coded (dd54383). Owner-directed mid-flight: type-scale conformance, tile + row color coding. Verified live on demo: JUL 2026 derived and reconciling to the cent, drill-down expand/collapse single-open, sheet month 2026-01 stored + chevronless, APR 2026 empty state (no CTA, points at Connections), PUT/POST 405. Editing-loss bug closed by design: page never writes.

### 2026-07-27

- `[OPS]` Bug-report triage (11 Replay reports, external QA agent): all recorded against a stale build — old muted color, old "Enter PIN" heading, value-only manual-asset edit, pre-derivation Cash Flow. Root cause of the reports themselves: an orphaned dev server from 2026-07-24 was still serving port 3000; killed and replaced with the harness-managed demo server, so the tunnel/demo now serves current code.
- `[OPS]` Re-verified every report live against the current build (loaded `127.0.0.1:3000` rather than `localhost:3000` — different cookie host, so the PIN gate renders locked without clearing an httpOnly session). **Confirmed fixed:** muted text contrast now 5.20:1 (passes WCAG AA; measured in-page); "Digits only — 6-digit PIN" hint on non-digit input; Unlock disabled until 6 digits; heading reads "Enter your 6-digit PIN"; wrong PIN returns 200 `{ok:false}` → inline "Wrong PIN", retryable, no Next.js forbidden page; Cash Flow renders derived with no empty state; manual-asset `Edit…` dialog exposes a name field, so rename works.
- `[OPS]` **BUG FOUND (open):** every Cash Flow edit is silently discarded on any month that has transactions. The card-switch auto-save works correctly (a PUT does fire), but `buildBudgetData` (`app/api/budget/route.ts:64-79`) re-derives from transactions and overwrites the just-saved values before responding. Proven via API: `PUT {fixed:[{label:"ZZZ-TEST",value:9999}]}` returns 200, yet both the response body and a subsequent GET return the original derived rows. The Cash Flow pencil/Edit UI is effectively decorative for covered months. Decision (Alena, same day): make Cash Flow read-only and drop the tax set-aside row — design spec pending.
- `[OPS]` Noted: manual-asset dialog inputs have no `aria-label` or `<label>` — placeholder-only accessible name. Minor a11y gap, not yet fixed.
- `[GIT]` Pushed to `github.com/alenabeex/plutus` (private): `1267472..69956a8`, 12 commits — Plaid item revoke on connection remove, orphan-row sweep (×2), `last_synced` stored as a real timestamp, blank install seeds categories only, demo `distDir` split (`.next-demo`, lets the real and demo servers run together), manual-asset icons + label edit, health-dot reasons (×2), mask disambiguation for duplicate account names, institution logo backfill on sync, lint/render-purity fixes. Code only — no financial data, no secrets.
- `[FILE]` Cash Flow redesign spec written + committed (docs/superpowers/specs/2026-07-27-cashflow-readonly-monarch-design.md): read-only page, Monarch-style — savings-rate tile, income allocation bar, category-level rows with inline drill-down; pencils/tax-row/PUT/POST removed. Pattern chosen by Alena from a Copilot/Monarch/Empower/YNAB/Mint comparison. Awaiting her spec review before implementation planning.
- `[FILE]` Created this log. Project activity split out of the vault's `00_system/activity.md`, which is for vault operations only (per Alena). Pre-2026-07-27 project entries left in place there as historical record.
