@AGENTS.md

# Plutus — working notes

Read `README.md` to run it, `../finance-tracker-plan.md` for the build plan,
and `../AGENTS.md` for the data guardrails (hard rules — read those first).
This file is only what none of those tell you and a fresh session would
otherwise get wrong or re-propose.

## Decisions that are settled — don't re-open these

- **Free, open-source, self-hosted. No monetization, ever.** Not open-core
  later either — "no money, keep it free" (2026-07-22). Plutus is a
  portfolio project for the job sprint; success = shipped, public, case
  study, stars. Never revenue. Job-sprint time always outranks Plutus time.
- **No cloud. No Vercel, no hosted anything.** Users run it locally:
  SQLite only, Docker optional, opt-in `--lan` for phone PWA. Hosted
  deploy + phone Face ID (needs HTTPS) live in the backlog, revived only
  if users ask.
- **IA locked: Net Worth · Cash Flow · Transactions · Subscriptions ·
  Connections.** Five tabs. Budgets were dropped deliberately ("we don't
  use budgets, too much work for the user") — Cash Flow auto-derives
  everything from synced transactions, zero setup. Don't propose a budget
  view.
- **Net Worth is the design-template reference.** Every view conforms to
  its system (title, hero number, semantic red/green) via the T8.1 view
  template. New views copy it, not invent.
- **Design system = real shadcn, new-york preset** (aligned 2026-08-07,
  refined 2026-08-19). Tokens live in `app/globals.css` `:root` and are
  mirrored as constants in `lib/colors.ts` (INK, MUTED, LINE, SOFT, CARD,
  GOOD, BAD) — the two must stay in sync; each file's comments say so.
- **GOOD/BAD are money-direction semantics only** (gain/loss,
  asset/liability). Never use them for static decoration. WARN is the
  connection-staleness amber; the GREAT/TINT_* grade scale belongs to the
  Cash Flow savings-rate tile.
- **Every popover menu is the Export-menu pattern**: full-width rows,
  SOFT rounded hover — `MENU_ITEM` + `menuItemHover` in `lib/styles.ts`
  (Alena, 2026-07-29). No ad-hoc dropdown styling.
- **Nav bar stretches full width** — not capped at 660px (2026-08-07
  layout call).
- **The middleware file is `proxy.ts`, on purpose.** Next.js 16 renamed
  the convention from `middleware.ts` to `proxy.ts`; it was renamed back
  and forth twice (820e6d1 → ea2364c) before landing here. It IS active —
  don't "fix" it back to middleware.ts.
- **Backfilled months gate behind Sync Month** — imported history must
  never appear pre-reviewed (a83a433).
- **AI categorization sees merchant names only** — no amounts, dates, or
  balances. Every AI answer becomes a durable `category_rules` row; the
  AI never writes to transactions directly.
- **The pre-scrub git history is never published.** Early history
  contained real numbers. The public repo (github.com/alenabeex/plutus)
  carries a fresh clean history; anything public flows through it only.

## Rejected, with reasons

- **Full XLSX import** — dropped 2026-07-22. Plaid sync + manual edit is
  the data path; only the Budget Summary tab is imported for the long-run
  savings trend. Excel export = backlog.
- **Hosted one-click deploy** — "no Vercel for now, people run it
  locally." Backlog, not a phase.
- **Shared Button primitive** — real (8 hand-rolled padding pairings,
  2026-07-23 audit) but deferred to backlog; don't build it in passing.

## How agents work here

- **Demo mode always: `FT_DEMO=1 pnpm dev`.** Never the real DB, never
  real Plaid, never Keychain secret values. Full rules in `../AGENTS.md`.
- **Ports: 8420 is Alena's real instance — never browse it. 3000 is the
  demo instance — agents work there.** Demo PIN: 111111.
- **Verify in place.** No throwaway `/dev-preview` routes for
  screenshots — edit the real files, check them in the demo instance,
  let Alena look herself.
- **Tests are Vitest**, in `lib/__tests__/`. Derivation logic
  (`derive.ts`, `apply-modified-txn.ts`) is the tested seam.
- **Coding practice is binding**: the plan's "Coding practice" section
  (borjasolerme coding-workflow). Smallest coherent change, reuse
  existing patterns, TDD slices for normal changes, commit each completed
  change with scoped messages.
- **Design exploration lives vault-side in `../prototype/`** — concept
  HTMLs, wireframes. Reference for design intent; never mixed into the
  app repo.
