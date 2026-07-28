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

  const noTxns = (r: { label: string; value: number }, grp?: "need" | "want"): CashflowRow =>
    ({ ...r, txns: [], ...(grp ? { grp } : {}) });
  const income = (JSON.parse(row.income_json) as { label: string; value: number }[]).map((r) => noTxns(r));
  const fixed = (
    d.prepare(`SELECT label, amount FROM budget_fixed_items WHERE month = ? ORDER BY sort ASC`)
      .all(month) as { label: string; amount: number }[]
  ).map((f) => noTxns({ label: f.label, value: f.amount }, "need"));
  const variable = (JSON.parse(row.variable_json) as { label: string; value: number }[]).map((r) => noTxns(r, "want"));
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
