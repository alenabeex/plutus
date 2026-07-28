# Cash Flow Read-Only + Monarch-Style Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cash Flow a read-only analytics page — savings-rate tile, income allocation bar, category-level expense rows with inline transaction drill-down — and delete the edit machinery whose writes were being silently discarded.

**Architecture:** A new pure function `cashflowView` in `lib/derive.ts` groups the month's transactions by category (expenses) and payer (income), carrying each row's transactions for drill-down. `GET /api/budget` returns the new `CashflowData` shape (derived months) or a stored fallback (sheet months); `PUT` and `POST` are deleted. `components/views/budget.tsx` is rewritten as a display-only view. Spec: `docs/superpowers/specs/2026-07-27-cashflow-readonly-monarch-design.md`.

**Tech Stack:** Next.js (App Router), better-sqlite3-multiple-ciphers, Tailwind + inline styles with `lib/colors.ts` tokens, lucide-react icons, vitest (added by Task 1).

**Ground rules:** Demo numbers only in tests/fixtures (AGENTS.md §3). Dev server for live checks is the demo: `FT_DEMO=1`, port 3000 — never 8420. Repo commit style: `type(plutus): subject`.

**Coherence note:** Tasks 4 and 5 swap the API shape and its consumer. Typecheck stays green after every task, but the running demo is only coherent again after Task 5 — do Tasks 4 and 5 back-to-back.

---

### Task 1: Vitest harness

The repo has no test runner (scripts: dev/build/start/lint/format/typecheck/backup).

**Files:**
- Modify: `package.json` (devDependency + script)
- Create: `lib/__tests__/smoke.test.ts` (deleted again in Task 2)

- [ ] **Step 1: Install vitest**

Run: `pnpm add -D vitest`
Expected: `vitest` appears under devDependencies in `package.json`.

- [ ] **Step 2: Add test script**

In `package.json` scripts, after `"typecheck"`:

```json
"test": "vitest run",
```

- [ ] **Step 3: Write a smoke test**

Create `lib/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";

describe("test harness", () => {
  it("runs an in-memory sqlite db", () => {
    const d = new Database(":memory:");
    d.exec(`CREATE TABLE t (n INTEGER)`);
    d.prepare(`INSERT INTO t (n) VALUES (?)`).run(42);
    expect((d.prepare(`SELECT n FROM t`).get() as { n: number }).n).toBe(42);
    d.close();
  });
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test`
Expected: 1 passed. (If the native module errors under vitest, add `test: { pool: "forks" }` via a `vitest.config.ts` and re-run.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml lib/__tests__/smoke.test.ts
git commit -m "test(plutus): add vitest harness"
```

---

### Task 2: `cashflowView` in lib/derive.ts (TDD)

The data spine of the new page. One query, bucketed in JS: expenses grouped by category name (`Uncategorized` for NULL), income grouped by payer, every row carrying its transactions sorted date-desc. Needs/wants totals split by `categories.grp`.

**Files:**
- Modify: `lib/types.ts` (append new interfaces; do NOT touch `BudgetData` yet)
- Modify: `lib/derive.ts` (append `cashflowView`)
- Create: `lib/__tests__/cashflow-view.test.ts`
- Delete: `lib/__tests__/smoke.test.ts`

- [ ] **Step 1: Add types**

Append to `lib/types.ts`:

```ts
export interface CashflowTxn {
  id: number;
  date: string;   // '2026-07-21'
  label: string;  // merchant if set, else name
  value: number;  // display sign: positive dollars for both income and expenses
}

export interface CashflowRow {
  label: string;          // category (expenses) or payer (income)
  value: number;
  txns: CashflowTxn[];    // empty for stored/sheet months → no drill-down
}

export interface CashflowData {
  month: string;          // '2026-07'
  monthLabel: string;     // 'JUL 2026'
  months: string[];       // all months for the ‹ › nav
  source: "derived" | "stored";
  income: CashflowRow[];
  totalIncome: number;
  expenses: CashflowRow[]; // flat, ranked by value desc
  totalExpenses: number;
  totalNeeds: number;      // for the allocation bar
  totalWants: number;
  saved: number;           // totalIncome − totalExpenses
}
```

- [ ] **Step 2: Write the failing tests**

Create `lib/__tests__/cashflow-view.test.ts`. The fixture builds only the columns `cashflowView` reads — it must not import `lib/db.ts` (that module reaches for the Keychain).

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import { cashflowView } from "../derive";

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      sort INTEGER DEFAULT 0, grp TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, date TEXT, name TEXT, merchant TEXT,
      amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0,
      txn_class TEXT
    );
  `);
  const cat = d.prepare(`INSERT INTO categories (name, sort, grp) VALUES (?, ?, ?)`);
  cat.run("Rent / Housing", 1, "need");   // id 1
  cat.run("Utilities", 2, "need");        // id 2
  cat.run("Groceries", 3, "want");        // id 3
  cat.run("Eat Out", 4, "want");          // id 4
  return d;
}

// Plaid sign convention: positive = money out, income is negative.
function txn(d: Database.Database, t: {
  date: string; name: string; merchant?: string; amount: number;
  category_id?: number; pending?: number; txn_class?: string;
}) {
  d.prepare(
    `INSERT INTO transactions (date, name, merchant, amount, category_id, pending, txn_class)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.date, t.name, t.merchant ?? null, t.amount, t.category_id ?? null,
        t.pending ?? 0, t.txn_class ?? "expense");
}

describe("cashflowView", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("groups expenses by category, ranked by amount desc", () => {
    txn(d, { date: "2026-07-01", name: "OAKWOOD ACH", merchant: "Oakwood Properties", amount: 1850, category_id: 1 });
    txn(d, { date: "2026-07-14", name: "SAFEWAY", merchant: "Safeway", amount: 112.25, category_id: 3 });
    txn(d, { date: "2026-07-21", name: "TRADER JOES", merchant: "Trader Joe's", amount: 63.2, category_id: 3 });
    const v = cashflowView("2026-07", d);
    expect(v.expenses.map((e) => e.label)).toEqual(["Rent / Housing", "Groceries"]);
    expect(v.expenses[1].value).toBe(175.45);
  });

  it("carries each row's transactions, newest first, merchant preferred over name", () => {
    txn(d, { date: "2026-07-14", name: "SAFEWAY #1234", merchant: "Safeway", amount: 112.25, category_id: 3 });
    txn(d, { date: "2026-07-21", name: "TJ MAIDEN LN", merchant: "Trader Joe's", amount: 63.2, category_id: 3 });
    const v = cashflowView("2026-07", d);
    const g = v.expenses.find((e) => e.label === "Groceries")!;
    expect(g.txns.map((t) => t.label)).toEqual(["Trader Joe's", "Safeway"]);
    expect(g.txns[0]).toMatchObject({ date: "2026-07-21", value: 63.2 });
  });

  it("buckets uncategorized expenses into their own row", () => {
    txn(d, { date: "2026-07-05", name: "MYSTERY POS", amount: 66.5 });
    const v = cashflowView("2026-07", d);
    expect(v.expenses).toHaveLength(1);
    expect(v.expenses[0].label).toBe("Uncategorized");
    expect(v.expenses[0].value).toBe(66.5);
  });

  it("splits needs and wants totals by category group (uncategorized counts as want)", () => {
    txn(d, { date: "2026-07-01", name: "RENT", amount: 1850, category_id: 1 });
    txn(d, { date: "2026-07-02", name: "PG&E", amount: 138.7, category_id: 2 });
    txn(d, { date: "2026-07-03", name: "SAFEWAY", amount: 175.45, category_id: 3 });
    txn(d, { date: "2026-07-04", name: "MYSTERY", amount: 66.5 });
    const v = cashflowView("2026-07", d);
    expect(v.totalNeeds).toBe(1988.7);
    expect(v.totalWants).toBe(241.95);
    expect(v.totalExpenses).toBe(2230.65);
  });

  it("groups income by payer with positive display values", () => {
    txn(d, { date: "2026-07-15", name: "ACME CORP PAYROLL", merchant: "Acme Corp", amount: -2600, txn_class: "income" });
    txn(d, { date: "2026-07-31", name: "ACME CORP PAYROLL", merchant: "Acme Corp", amount: -2600, txn_class: "income" });
    const v = cashflowView("2026-07", d);
    expect(v.income).toEqual([
      { label: "Acme Corp", value: 5200, txns: [
        { id: 2, date: "2026-07-31", label: "Acme Corp", value: 2600 },
        { id: 1, date: "2026-07-15", label: "Acme Corp", value: 2600 },
      ]},
    ]);
    expect(v.totalIncome).toBe(5200);
  });

  it("ignores pending, transfers, and other months", () => {
    txn(d, { date: "2026-07-10", name: "PENDING", amount: 50, category_id: 3, pending: 1 });
    txn(d, { date: "2026-07-11", name: "CC PAYMENT", amount: 500, txn_class: "transfer" });
    txn(d, { date: "2026-06-11", name: "LAST MONTH", amount: 40, category_id: 3 });
    const v = cashflowView("2026-07", d);
    expect(v.txnCount).toBe(0);
    expect(v.expenses).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `cashflowView` is not exported from `../derive`.

- [ ] **Step 4: Implement `cashflowView`**

Append to `lib/derive.ts` (after `cashflowFromTransactions`; `round2` already exists in this file):

```ts
export interface DerivedCashflowView {
  income: CashflowRow[];
  totalIncome: number;
  expenses: CashflowRow[];   // flat, ranked by value desc; 'Uncategorized' bucket included
  totalExpenses: number;
  totalNeeds: number;
  totalWants: number;
  txnCount: number;
}

/** The read-only Cash Flow page's data (spec 2026-07-27): expenses grouped by
 *  CATEGORY (merchants live inside each row's txns), income grouped by payer,
 *  needs/wants totals split by categories.grp for the allocation bar.
 *  Plaid sign convention: positive = money out; display values are positive
 *  on both sides. Transfers/pending are excluded via txn_class/pending. */
export function cashflowView(month: string, d: Database.Database = db()): DerivedCashflowView {
  const rows = d.prepare(
    `SELECT t.id, t.date, COALESCE(NULLIF(TRIM(t.merchant), ''), t.name, '?') label,
            t.amount, t.txn_class, c.name cat, c.grp
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.pending = 0 AND t.date LIKE ? AND t.txn_class IN ('income', 'expense')
     ORDER BY t.date DESC, t.id DESC`,
  ).all(`${month}%`) as {
    id: number; date: string; label: string; amount: number;
    txn_class: "income" | "expense"; cat: string | null; grp: string | null;
  }[];

  const incomeBy = new Map<string, CashflowRow>();
  const expenseBy = new Map<string, CashflowRow>();
  let totalNeeds = 0;

  for (const r of rows) {
    if (r.txn_class === "income") {
      const row = incomeBy.get(r.label) ?? { label: r.label, value: 0, txns: [] };
      row.value = round2(row.value + -r.amount);
      row.txns.push({ id: r.id, date: r.date, label: r.label, value: round2(-r.amount) });
      incomeBy.set(r.label, row);
    } else {
      const key = r.cat ?? "Uncategorized";
      const row = expenseBy.get(key) ?? { label: key, value: 0, txns: [] };
      row.value = round2(row.value + r.amount);
      row.txns.push({ id: r.id, date: r.date, label: r.label, value: round2(r.amount) });
      expenseBy.set(key, row);
      if (r.grp === "need") totalNeeds = round2(totalNeeds + r.amount);
    }
  }

  const income = [...incomeBy.values()].sort((a, b) => b.value - a.value);
  const expenses = [...expenseBy.values()].sort((a, b) => b.value - a.value);
  const totalIncome = round2(income.reduce((s, r) => s + r.value, 0));
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.value, 0));

  return {
    income, totalIncome, expenses, totalExpenses,
    totalNeeds, totalWants: round2(totalExpenses - totalNeeds),
    txnCount: rows.length,
  };
}
```

Add to the imports at the top of `lib/derive.ts`:

```ts
import type { CashflowRow } from "./types";
```

(If `round2` does not exist in `derive.ts`, add `const round2 = (n: number) => Math.round(n * 100) / 100;` near the top.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: all `cashflowView` tests PASS.

- [ ] **Step 6: Delete the smoke test, typecheck, commit**

```bash
rm lib/__tests__/smoke.test.ts
pnpm typecheck
git add lib/types.ts lib/derive.ts lib/__tests__/
git commit -m "feat(plutus): cashflowView — category-level cash flow with per-row transactions"
```

---

### Task 3: Rework GET /api/budget, delete PUT and POST

**Files:**
- Modify: `app/api/budget/route.ts` (rewrite)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/budget/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthLabel, isValidMonthKey } from "@/lib/format";
import { cashflowView, classifyTransactions, categorizeTransactions, ensureMonthsFromTransactions } from "@/lib/derive";
import type { CashflowData, CashflowRow } from "@/lib/types";

export const runtime = "nodejs";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Read-only Cash Flow payload (spec 2026-07-27). Months with transactions
 *  derive everything live via cashflowView. Sheet-imported months — and any
 *  manual month left from before the read-only change — fall back to their
 *  stored JSON, with empty txns so the view renders them without drill-down.
 *  There is no write path: PUT/POST were removed with the editing UI. */
function buildCashflowData(month: string): CashflowData {
  const d = db();
  const row = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as {
    month: string; income_json: string; variable_json: string;
    total_income: number; total_fixed: number; total_variable: number;
    source: string | null;
  } | undefined;
  if (!row) throw new Error(`Month ${month} not found`);

  const months = (
    d.prepare(`SELECT month FROM budget_months ORDER BY month ASC`).all() as { month: string }[]
  ).map((r) => r.month);
  const base = { month, monthLabel: monthLabel(month), months };

  if (row.source !== "sheet") {
    const v = cashflowView(month, d);
    if (v.txnCount > 0) {
      return {
        ...base, source: "derived",
        income: v.income, totalIncome: v.totalIncome,
        expenses: v.expenses, totalExpenses: v.totalExpenses,
        totalNeeds: v.totalNeeds, totalWants: v.totalWants,
        saved: round2(v.totalIncome - v.totalExpenses),
      };
    }
  }

  const noTxns = (r: { label: string; value: number }): CashflowRow => ({ ...r, txns: [] });
  const income = (JSON.parse(row.income_json) as { label: string; value: number }[]).map(noTxns);
  const fixed = (
    d.prepare(`SELECT label, amount FROM budget_fixed_items WHERE month = ? ORDER BY sort ASC`)
      .all(month) as { label: string; amount: number }[]
  ).map((f) => noTxns({ label: f.label, value: f.amount }));
  const variable = (JSON.parse(row.variable_json) as { label: string; value: number }[]).map(noTxns);
  const expenses = [...fixed, ...variable]
    .filter((e) => e.value !== 0)
    .sort((a, b) => b.value - a.value);
  const totalExpenses = round2(row.total_fixed + row.total_variable);

  return {
    ...base, source: "stored",
    income, totalIncome: row.total_income,
    expenses, totalExpenses,
    totalNeeds: row.total_fixed, totalWants: row.total_variable,
    saved: round2(row.total_income - totalExpenses),
  };
}

function latestMonth(): string {
  const row = db()
    .prepare(`SELECT month FROM budget_months ORDER BY month DESC LIMIT 1`)
    .get() as { month: string } | undefined;
  return row?.month ?? "";
}

export const GET = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  // Lazy derivation pass — sync runs it too, but demo/no-sync installs only
  // hit this path. All three are idempotent and cheap on a settled ledger.
  const d = db();
  classifyTransactions(d);
  categorizeTransactions(d);
  ensureMonthsFromTransactions(d);

  const url = new URL(req.url);
  const supplied = url.searchParams.get("month");
  if (supplied && !isValidMonthKey(supplied)) {
    return NextResponse.json({ error: "bad-month" }, { status: 400 });
  }
  const month = supplied || latestMonth();

  if (!month) {
    return NextResponse.json({ error: "No budget months found" }, { status: 404 });
  }

  try {
    return withRefreshedSession(req, buildCashflowData(month));
  } catch {
    // Month has no sheet yet — tell the client which months DO exist so the
    // picker still works.
    const months = (
      db().prepare(`SELECT month FROM budget_months ORDER BY month ASC`).all() as { month: string }[]
    ).map((r) => r.month);
    return NextResponse.json({ error: "month-not-found", month, months }, { status: 404 });
  }
});
```

Deleted along the way: the `PUT` handler, the `POST` handler, `validItems`, the old `buildBudgetData`, and the imports of `gradeFor`, `createMonth`/`BudgetOpsError`/`CreateMode` (from `@/lib/budget-ops`), `cashflowFromTransactions`, and `BudgetData`.

- [ ] **Step 2: Typecheck — expect exactly one kind of error**

Run: `pnpm typecheck`
Expected: errors ONLY in `components/views/budget.tsx` (it still consumes the old shape). Any error in `app/api/budget/route.ts` itself must be fixed now.

- [ ] **Step 3: Commit**

```bash
git add app/api/budget/route.ts
git commit -m "feat(plutus): budget API is read-only — GET serves CashflowData, PUT/POST removed"
```

(Typecheck is red at this commit by design; Task 4 lands the consumer. Do not push between Tasks 3 and 4.)

---

### Task 4: Rewrite the Cash Flow view

**Files:**
- Modify: `components/views/budget.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire contents of `components/views/budget.tsx`**

```tsx
"use client";

// Cash Flow — read-only analytics (spec 2026-07-27). Numbers derive from
// transactions; the page never writes. Drill-down (expand a row to its
// transactions) replaces editing: wrong number → fix the transaction's
// category, not the sheet. Sheet-imported months render from stored JSON
// with no drill-down (txns are empty).
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MonthPicker } from "@/components/month-picker";
import { CARD, LINE, SOFT, MUTED, INK, GOOD } from "@/lib/colors";
import { usd } from "@/lib/format";
import type { CashflowData, CashflowRow } from "@/lib/types";

interface BudgetViewProps {
  month: string;
  onMonthChange: (m: string) => void;
  dataMonths: string[];
  monthMin?: string;
  monthMax?: string;
  onMonthsChanged: () => void;
  onLocked: () => void;
}

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="flex-1 rounded-2xl p-4"
      style={{ background: accent ? SOFT : CARD, border: `1px solid ${LINE}` }}
    >
      <div className="text-xs mb-1" style={{ color: MUTED }}>{label}</div>
      <div className="text-2xl font-medium" style={{ color: accent ? GOOD : INK }}>{value}</div>
    </div>
  );
}

function AllocationBar({ needs, wants, income }: { needs: number; wants: number; income: number }) {
  if (income <= 0) return null;
  const needsPct = pct(needs, income);
  const wantsPct = pct(wants, income);
  const savedPct = Math.max(0, 100 - needsPct - wantsPct);
  const seg = [
    { label: `Needs ${needsPct}%`, w: needsPct, color: INK },
    { label: `Wants ${wantsPct}%`, w: wantsPct, color: MUTED },
    { label: `Saved ${savedPct}%`, w: savedPct, color: GOOD },
  ].filter((s) => s.w > 0);
  return (
    <div className="mb-6">
      <div className="text-xs mb-2" style={{ color: MUTED }}>Where this month&apos;s income went</div>
      <div className="flex h-3 overflow-hidden rounded-full" role="img"
           aria-label={seg.map((s) => s.label).join(", ")}>
        {seg.map((s) => (
          <div key={s.label} style={{ width: `${s.w}%`, background: s.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        {seg.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ row, total, open, onToggle }: {
  row: CashflowRow; total: number; open: boolean; onToggle: () => void;
}) {
  const drillable = row.txns.length > 0;
  const share = pct(row.value, total);
  return (
    <div style={{ borderTop: `1px solid ${LINE}` }}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-1 py-2.5 text-left"
        style={{ cursor: drillable ? "pointer" : "default" }}
        onClick={drillable ? onToggle : undefined}
        aria-expanded={drillable ? open : undefined}
        aria-label={drillable ? `${row.label}: ${usd(row.value)} — show transactions` : undefined}
        disabled={!drillable}
      >
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-sm" style={{ color: INK }}>
            <span className="truncate">{row.label}</span>
            <span>{usd(row.value)}</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full" style={{ background: SOFT }}>
            <div className="h-1 rounded-full" style={{ width: `${share}%`, background: MUTED }} />
          </div>
        </div>
        <span className="w-9 text-right text-xs" style={{ color: MUTED }}>{share}%</span>
        {drillable ? (
          open
            ? <ChevronDown size={15} style={{ color: MUTED }} aria-hidden />
            : <ChevronRight size={15} style={{ color: MUTED }} aria-hidden />
        ) : (
          <span className="w-[15px]" aria-hidden />
        )}
      </button>
      {drillable && open && (
        <div className="mb-2 ml-3 border-l-2 pl-3" style={{ borderColor: LINE }}>
          {row.txns.map((t) => (
            <div key={t.id} className="flex justify-between py-1 pr-8 text-xs" style={{ color: MUTED }}>
              <span className="truncate">{t.date.slice(5)} · {t.label}</span>
              <span>{usd(t.value)}</span>
            </div>
          ))}
          <div className="py-1 text-xs" style={{ color: MUTED }}>
            Wrong category? Fix it on the transaction.
          </div>
        </div>
      )}
    </div>
  );
}

export default function BudgetView({
  month, onMonthChange, dataMonths, monthMin, monthMax, onMonthsChanged, onLocked,
}: BudgetViewProps) {
  const [data, setData] = useState<CashflowData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchedMonth, setFetchedMonth] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/budget?month=${month}`, { credentials: "same-origin" });
    if (res.status === 401) { onLocked(); return; }
    if (res.status === 404) {
      setData(null); setNotFound(true); setLoading(false); setFetchedMonth(month);
      onMonthsChanged();
      return;
    }
    if (!res.ok) { setLoading(false); return; }
    const d: CashflowData = await res.json();
    setData(d); setNotFound(false); setLoading(false); setFetchedMonth(month);
    setOpenRow(null);
    onMonthsChanged();
  }, [month, onLocked, onMonthsChanged]);

  useEffect(() => { if (fetchedMonth !== month) void load(); }, [month, fetchedMonth, load]);

  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  const menuItem: React.CSSProperties = {
    all: "unset" as unknown as undefined,
    display: "block", width: "100%", boxSizing: "border-box",
    padding: "9px 12px", borderRadius: 10, fontSize: 13.5, color: INK, cursor: "pointer",
  };

  const header = (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-2xl font-semibold" style={{ color: INK }}>Cash Flow</h1>
      <MonthPicker month={month} onChange={onMonthChange} dataMonths={dataMonths} min={monthMin} max={monthMax}>
        <div ref={plusRef} className="relative">
          <button
            type="button"
            aria-label="Export"
            title="Export this month (.xlsx)"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ border: `1px solid ${LINE}`, background: CARD, color: MUTED }}
            onClick={() => setPlusOpen((o) => !o)}
          >⋯</button>
          {plusOpen && (
            <div
              className="absolute right-0 z-20 p-2"
              style={{
                top: 38, background: CARD, border: `1px solid ${LINE}`,
                borderRadius: 14, boxShadow: "0 8px 30px rgba(16,17,20,.12)", width: 230,
              }}
            >
              {!notFound && (
                <button style={menuItem}
                  onClick={() => { setPlusOpen(false); window.location.href = `/api/budget/export?month=${month}`; }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = SOFT)}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
                  Export this month (.xlsx)
                </button>
              )}
            </div>
          )}
        </div>
      </MonthPicker>
    </div>
  );

  if (loading) {
    return <div>{header}<div className="p-10 text-sm" style={{ color: MUTED }}>Loading…</div></div>;
  }

  if (notFound || !data) {
    return (
      <div>
        {header}
        <div className="rounded-2xl p-10 text-center" style={{ background: CARD, border: `1px solid ${LINE}` }}>
          <div className="text-sm" style={{ color: INK }}>Nothing here yet.</div>
          <div className="mx-auto mt-2 max-w-md text-sm" style={{ color: MUTED }}>
            Cash Flow builds itself from your transactions — there&apos;s nothing to set up.
            Link an account under Connections and this month fills in on the next sync.
          </div>
        </div>
      </div>
    );
  }

  const rate = data.totalIncome > 0 ? pct(data.saved, data.totalIncome) : null;

  return (
    <div>
      {header}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Tile label="Income" value={usd(data.totalIncome)} />
        <Tile label="Expenses" value={usd(data.totalExpenses)} />
        <Tile label="Saved" value={usd(data.saved)} />
        <Tile label="Savings rate" value={rate === null ? "—" : `${rate}%`} accent />
      </div>

      <AllocationBar needs={data.totalNeeds} wants={data.totalWants} income={data.totalIncome} />

      <div className="mb-4 rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-1 text-xs" style={{ color: MUTED }}>Expenses by category</div>
        {data.expenses.length === 0 && (
          <div className="py-3 text-sm" style={{ color: MUTED }}>No expenses this month.</div>
        )}
        {data.expenses.map((row) => (
          <Row key={row.label} row={row} total={data.totalExpenses}
               open={openRow === `e:${row.label}`}
               onToggle={() => setOpenRow(openRow === `e:${row.label}` ? null : `e:${row.label}`)} />
        ))}
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${LINE}` }}>
        <div className="mb-1 text-xs" style={{ color: MUTED }}>Income</div>
        {data.income.length === 0 && (
          <div className="py-3 text-sm" style={{ color: MUTED }}>No income this month.</div>
        )}
        {data.income.map((row) => (
          <Row key={row.label} row={row} total={data.totalIncome}
               open={openRow === `i:${row.label}`}
               onToggle={() => setOpenRow(openRow === `i:${row.label}` ? null : `i:${row.label}`)} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. If `lib/colors.ts` does not export a name used above (e.g. `GOOD`), check the file and substitute the repo's actual token — do not invent new colors.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: all pass (view has no unit tests; this guards derive).

- [ ] **Step 4: Commit**

```bash
git add components/views/budget.tsx
git commit -m "feat(plutus): Cash Flow view is read-only — tiles, allocation bar, drill-down rows"
```

---

### Task 5: Sweep dead code

**Files:**
- Modify: `lib/types.ts` (delete `BudgetData`)
- Verify-only: `app/page.tsx`, `lib/budget-ops.ts`, `lib/format.ts`

- [ ] **Step 1: Delete the `BudgetData` interface from `lib/types.ts`** (the whole block: `export interface BudgetData { ... }`). It has no remaining importers after Tasks 3–4.

- [ ] **Step 2: Confirm nothing else refers to removed machinery**

Run: `grep -rn "BudgetData\|startEdit\|saveIncome\|saveExpenses\|editCard\|taxSetAside\|createMonth(" --include="*.ts" --include="*.tsx" app components lib | grep -v node_modules`
Expected: no hits outside `lib/budget-ops.ts` (its `createMonth` keeps callers in `scripts/cli.ts` and `lib/sheet-io.ts` — leave it).

- [ ] **Step 3: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "chore(plutus): drop BudgetData — CashflowData replaced it"
```

---

### Task 6: Live verification against the demo

**Files:** none (verification + log only)

- [ ] **Step 1: Start the demo server** (harness-managed, port 3000, `FT_DEMO=1` — per `.claude/launch.json`; never port 8420).

- [ ] **Step 2: API checks** (cookie-jar unlock exactly as in `activity.md` 2026-07-27 entries; Origin header required):

```bash
curl -s -b cj.txt "http://localhost:3000/api/budget?month=2026-07" | python3 -m json.tool | head -40
```
Expected: `source: "derived"`, tiles reconcile (`totalIncome − totalExpenses = saved` exactly), each expense row has a `txns` array.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -b cj.txt -X PUT http://localhost:3000/api/budget -H "Content-Type: application/json" -d '{}'
```
Expected: `405`.

- [ ] **Step 3: Browser checks** (fresh locked host `127.0.0.1:3000`, demo PIN):
  - Four tiles render; savings-rate tile shows a percentage
  - Allocation bar segments + legend sum to 100%
  - Expense rows are category-level; clicking one expands its transactions, clicking another closes the first
  - No Edit pencil, no tax set-aside row, no "Start this month" anywhere
  - A month with no data shows the Connections-pointing empty state, no CTA button
  - Dark mode pass (`resize_window` colorScheme dark)

- [ ] **Step 4: Log to `activity.md`** (the app repo's, not the vault's): one `[FILE]` line — Cash Flow read-only + Monarch layout shipped, spec + plan paths, verification summary.

- [ ] **Step 5: Final commit**

```bash
git add activity.md
git commit -m "docs(plutus): log Cash Flow read-only ship + verification"
```

---

## Self-review notes

- Spec coverage: tiles/bar/rows/drill-down (Tasks 2, 4), removals incl. PUT/POST (Tasks 3–5), empty + sheet-month edge states (Task 3 fallback + Task 4 view), savings-rate replaces grade (Task 4; grade simply unused by this page — `gradeFor` stays for sheet-io/budget-ops/db callers), verification (Tasks 2, 6). Cash/invested split rows: absent from the new view (removal by omission — nothing renders them).
- `createMonth` UI flow dies with the rewrite (Task 4 has no `createMonth`); the lib function stays for import/CLI callers. Checked: `page.tsx` only imports the view's default export — props unchanged.
- Type names consistent across tasks: `CashflowData` / `CashflowRow` / `CashflowTxn` defined once in Task 2 Step 1, consumed in Tasks 3–4.
- Known mid-branch red state: after Task 3, typecheck fails until Task 4 lands — called out in both places.
