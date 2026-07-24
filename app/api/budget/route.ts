import { NextRequest, NextResponse } from "next/server";
import { requireUnlocked, withRefreshedSession, withJsonErrors } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthLabel, isValidMonthKey, gradeFor } from "@/lib/format";
import { createMonth, BudgetOpsError, type CreateMode } from "@/lib/budget-ops";
import { variableFromTransactions } from "@/lib/derive";
import type { BudgetData } from "@/lib/types";

export const runtime = "nodejs";

/** label non-empty string + finite value — PUT body items are untrusted */
function validItems(items: unknown): items is { label: string; value: number }[] {
  return Array.isArray(items) && items.every(
    (i) => i && typeof i === "object" &&
      typeof (i as { label: unknown }).label === "string" && (i as { label: string }).label.trim() !== "" &&
      Number.isFinite((i as { value: unknown }).value),
  );
}

function buildBudgetData(month: string): BudgetData {
  const d = db();

  const row = d
    .prepare(`SELECT * FROM budget_months WHERE month = ?`)
    .get(month) as {
    month: string;
    income_json: string;
    tax_set_aside: number;
    variable_json: string;
    total_income: number;
    total_fixed: number;
    total_variable: number;
    savings: number;
    cash_pct: number | null;
    cash_amt: number | null;
    invested_pct: number | null;
    invested_amt: number | null;
    grade: string | null;
    closed: number;
    source: string | null;
  } | undefined;

  if (!row) throw new Error(`Month ${month} not found`);

  const income = JSON.parse(row.income_json) as { label: string; value: number }[];
  let variable = JSON.parse(row.variable_json) as { label: string; value: number }[];
  let totalVariable = row.total_variable;
  let savingsAmt = row.savings;

  // Derivation (plan T4.3): once linked connections have synced transactions
  // for this month, variable spending comes LIVE from categorized
  // transactions — the stored JSON is only the manual fallback for months
  // without transaction coverage. Sheet-imported history is never overridden.
  if (row.source !== "sheet") {
    const derived = variableFromTransactions(month, d);
    if (derived.txnCount > 0) {
      variable = derived.variable;
      totalVariable = derived.totalVariable;
      savingsAmt = Math.round((row.total_income - row.total_fixed - totalVariable) * 100) / 100;
    }
  }

  const fixed = d
    .prepare(`SELECT label, amount FROM budget_fixed_items WHERE month = ? ORDER BY sort ASC`)
    .all(month) as { label: string; amount: number }[];

  const allMonths = (
    d.prepare(`SELECT month FROM budget_months ORDER BY month ASC`).all() as { month: string }[]
  ).map((r) => r.month);

  const totalLeftAfterFixed = row.total_income - row.total_fixed;

  // Single-source grade (lib/format): handles income<=0 → "—" and
  // negative savings → never "Great".
  const { grade, gradeColor } = gradeFor(row.total_income, totalVariable, savingsAmt);

  return {
    month: row.month,
    monthLabel: monthLabel(row.month),
    months: allMonths,
    income,
    taxSetAside: row.tax_set_aside ?? 0,
    totalIncome: row.total_income,
    totalLeftAfterFixed,
    fixed: fixed.map((f) => ({ label: f.label, value: f.amount })),
    totalFixed: row.total_fixed,
    variable,
    totalVariable,
    savings: {
      amount: savingsAmt,
      cashPct: row.cash_pct ?? 0,
      cashAmt: row.cash_amt ?? 0,
      investedPct: row.invested_pct ?? 0,
      investedAmt: row.invested_amt ?? 0,
      grade,
      gradeColor,
    },
  };
}

function latestMonth(): string {
  const d = db();
  const row = d
    .prepare(`SELECT month FROM budget_months ORDER BY month DESC LIMIT 1`)
    .get() as { month: string } | undefined;
  return row?.month ?? "";
}

export const GET = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

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
    return withRefreshedSession(req, buildBudgetData(month));
  } catch {
    // Month has no sheet yet — tell the client which months DO exist so the
    // picker still works and the view can offer to create this one.
    const months = (
      db().prepare(`SELECT month FROM budget_months ORDER BY month ASC`).all() as { month: string }[]
    ).map((r) => r.month);
    return NextResponse.json({ error: "month-not-found", month, months }, { status: 404 });
  }
});

export const PUT = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const d = db();
  const body = await req.json() as {
    month: string;
    income?: { label: string; value: number }[];
    fixed?: { label: string; value: number }[];
    variable?: { label: string; value: number }[];
    taxSetAside?: number;
  };

  const { month } = body;
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: "bad-month" }, { status: 400 });
  }
  // untrusted body: every supplied item must be well-shaped and finite
  for (const arr of [body.income, body.fixed, body.variable]) {
    if (arr !== undefined && !validItems(arr)) {
      return NextResponse.json({ error: "bad-item" }, { status: 400 });
    }
  }
  if (body.taxSetAside !== undefined && !Number.isFinite(body.taxSetAside)) {
    return NextResponse.json({ error: "bad-item" }, { status: 400 });
  }

  const existing = d
    .prepare(`SELECT closed FROM budget_months WHERE month = ?`)
    .get(month) as { closed: number } | undefined;

  if (!existing) return NextResponse.json({ error: "Month not found" }, { status: 404 });
  if (existing.closed) return NextResponse.json({ error: "Month is closed" }, { status: 400 });

  // Fetch current values to merge with
  const current = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as {
    income_json: string; variable_json: string; tax_set_aside: number; total_income: number;
    total_fixed: number; total_variable: number;
  };

  const income = body.income ?? (JSON.parse(current.income_json) as { label: string; value: number }[]);
  const variable = body.variable ?? (JSON.parse(current.variable_json) as { label: string; value: number }[]);
  const taxSetAside = body.taxSetAside ?? current.tax_set_aside;

  const totalIncome = income.reduce((s, i) => s + i.value, 0);
  const totalVariable = variable.reduce((s, v) => s + v.value, 0);

  // Fixed items: rewrite if provided
  let totalFixed = current.total_fixed;
  if (body.fixed) {
    d.prepare(`DELETE FROM budget_fixed_items WHERE month = ?`).run(month);
    const ins = d.prepare(`INSERT INTO budget_fixed_items (month,label,amount,sort) VALUES (?,?,?,?)`);
    body.fixed.forEach((f, i) => ins.run(month, f.label, f.value, i));
    totalFixed = body.fixed.reduce((s, f) => s + f.value, 0);
  }

  const savings = totalIncome - totalFixed - totalVariable;
  const { grade } = gradeFor(totalIncome, totalVariable, savings);

  d.prepare(
    `UPDATE budget_months SET income_json=?, tax_set_aside=?, variable_json=?,
     total_income=?, total_fixed=?, total_variable=?, savings=?, grade=?
     WHERE month=?`
  ).run(
    JSON.stringify(income), taxSetAside, JSON.stringify(variable),
    totalIncome, totalFixed, totalVariable, savings, grade, month
  );

  return withRefreshedSession(req, buildBudgetData(month));
});

export const POST = withJsonErrors(async (req: NextRequest) => {
  const locked = requireUnlocked(req);
  if (locked) return locked;

  const body = await req.json() as { action: "new"; mode?: CreateMode; month?: string };
  if (body.action !== "new") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (body.month !== undefined && !isValidMonthKey(body.month)) {
    return NextResponse.json({ error: "bad-month" }, { status: 400 });
  }

  try {
    const nextMonth = createMonth({ month: body.month, mode: body.mode });
    return withRefreshedSession(req, buildBudgetData(nextMonth));
  } catch (e) {
    if (e instanceof BudgetOpsError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
});
