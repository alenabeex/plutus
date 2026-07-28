# Cash Flow: read-only, Monarch-style — design spec

Date: 2026-07-27
Status: awaiting Alena's review
Decided by: Alena (this session), via pattern comparison against Copilot / Monarch / Empower / YNAB / Mint

## Why

Every Cash Flow edit is silently discarded on any month with transactions:
the card-switch auto-save PUTs correctly, but `buildBudgetData`
(`app/api/budget/route.ts:64-79`) re-derives from transactions and overwrites
the saved values before responding. The pencil UI is effectively decorative.
Proven 2026-07-27 via API (`PUT {fixed:[{label:"ZZZ-TEST",value:9999}]}` →
200, but response and subsequent GET both return derived rows).

Rather than add an override layer, Alena chose the industry pattern: Cash Flow
is read-only analytics (what Copilot, Monarch, Empower, Rocket Money all do).
The "edit" affordance becomes drill-down — see the transactions behind a
number — not typing over it.

## Decisions (locked, in order made)

1. **Cash Flow is always read-only.** Manual entry is not preserved anywhere —
   including empty months and sheet-imported months. (Alena, explicit.)
2. **Tax set-aside row is removed from the UI.** The one honest manual input
   dies with the rest; DB column stays, nothing writes it. (Alena, explicit.)
3. **Monarch-style layout adopted, scoped to the Cash Flow page only.**
   Savings-rate tile, income allocation bar, category-level rows with
   drill-down. No Transactions tab build, no other page touched. (Alena,
   explicit: "only for what's in cash flow.")

## Page layout (top to bottom)

1. **Header** — unchanged: month nav (‹ month ›, picker), `···` menu. Menu
   keeps exactly one item: Export this month (.xlsx).
2. **Four stat tiles** — Income, Expenses, Saved, Savings rate. Savings rate
   = round(saved / income × 100), accent-tinted tile; replaces the letter
   grade as the headline judgment. Income ≤ 0 → rate tile shows "—".
   (Demo July: $5,200 / $2,446 / $2,754 / 53%.)
3. **Income allocation bar** — single horizontal stacked bar: needs% /
   wants% / saved%. Legend beneath. Skipped when income ≤ 0.
4. **Expenses by category** — one flat list, category-level (not merchant),
   sorted by amount desc, each row: category name, amount, % of total
   expenses, thin proportion bar, chevron. Uncategorized appears as its own
   row when nonzero. The needs/wants distinction lives in the allocation
   bar, not as list sections.
5. **Income list** — same row treatment, grouped by payer (existing
   derivation), drill-down included.

## Drill-down (inline expand)

- Clicking a row expands it in place, listing that category's transactions
  for the viewed month: date · merchant/name · amount. Collapse on re-click;
  one row open at a time.
- Data: extend `GET /api/budget` response — each category entry gains its
  transactions (id, date, display name, amount). No new endpoint; the route
  already joins these tables. If payload size ever matters, revisit —
  a month of personal transactions does not.
- Purpose line at the bottom of the expand: "Wrong category? Fix it on the
  transaction" — inert copy for now (recategorize-in-app UI is future work;
  today the fix is `cli.ts categorize` rules). No dead buttons.

## Removals

UI (`components/views/budget.tsx`):
- Pencil Edit buttons, both cards
- Tax set-aside row
- "Start this month" button and the `createMonth` flow
- Savings cash/invested split rows (no home in the new layout; DB columns
  and any stored values stay — display only was already the case)
- All edit machinery: `editCard` state, `startEdit*` / `save*` / `switchTo*`,
  `incomeChanged` / `expensesChanged`, edit refs, `Line`'s `editMode` prop

API (`app/api/budget/route.ts`):
- `PUT` handler — deleted entirely. A route that accepts writes and then
  discards them is a trap; no caller remains.
- `POST action:"new"` — deleted; only `createMonth` called it.
- `GET` stays, gains drill-down transaction data per category.
- Server-side month materialization (`ensureMonthsFromTransactions`) stays —
  it is how months come to exist now.

## Edge states

- **Month with no transactions and no sheet**: empty state — no CTA button.
  Copy explains Cash Flow fills itself from transactions once an account is
  connected, pointing at Connections. Replaces "No sheet for X yet" +
  "Start this month".
- **Sheet-imported months (`source="sheet"`)**: render read-only from stored
  JSON as today. No transactions behind them → rows render without chevron,
  no expand. Frozen history, by design. Merchant-level labels from the sheet
  render as-is (no category rollup exists for them).
- **Partially categorized month**: Uncategorized row aggregates the gap so
  the tiles and bar always reconcile (Income − Expenses = Saved, exactly).

## Judgment calls made without asking (flag if wrong)

- Savings rate replaces the grade everywhere on this page.
- Cash/invested savings-split rows dropped from UI (kept in DB).
- One row expanded at a time.
- Needs/wants shown only in the allocation bar; expense list is one flat
  ranked list.

## Verification

- API test: `GET /api/budget?month=<demo month>` returns derived tiles that
  reconcile (income − expenses = saved), category rows with transactions
  arrays, and no `PUT`/`POST` handlers respond (405/404).
- Component: no Edit button, no tax row, no Start-this-month; chevron rows
  expand and collapse; sheet-sourced month renders without chevrons.
- Live pass against demo (`FT_DEMO=1`, port 3000), including the empty-state
  month and dark mode.
- Numbers in tests and fixtures: demo values only (AGENTS.md §3).
