import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import { isValidMonthKey, gradeFor } from "./format";

// Shared budget mutation ops — used by both app/api/budget/route.ts (HTTP)
// and scripts/cli.ts (`cli month-new`, no-HTTP). Keep this the single
// source of truth so the two callers never drift.

export class BudgetOpsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** '2026-01' + 1 → '2026-02' */
function nextMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 1-based, Date month 0-based → next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type CreateMode = "blank" | "copy";

/** Create a month sheet.
 *  - `month` given → create exactly that month (error if it exists).
 *  - `month` omitted → next calendar month after the latest.
 *  - mode "copy" → fixed items carried from the latest month before it;
 *    mode "blank" → everything zero.
 *  Returns the created month key. */
export function createMonth(
  opts: { month?: string; mode?: CreateMode } = {},
  d: Database.Database = db(),
): string {
  const mode = opts.mode ?? "copy";

  const latestRow = d
    .prepare(`SELECT month FROM budget_months ORDER BY month DESC LIMIT 1`)
    .get() as { month: string } | undefined;

  let target = opts.month;
  if (!target) {
    if (!latestRow) throw new BudgetOpsError("No months to roll over from", 404);
    target = nextMonthKey(latestRow.month);
  }
  if (!isValidMonthKey(target)) {
    throw new BudgetOpsError(`Bad month key: ${target}`, 400);
  }

  const exists = d.prepare(`SELECT month FROM budget_months WHERE month = ?`).get(target);
  if (exists) throw new BudgetOpsError("Month already exists", 400);

  // Source for "copy": latest month strictly before target, else latest overall
  let fixedItems: { label: string; amount: number; sort: number }[] = [];
  if (mode === "copy") {
    const src =
      (d.prepare(`SELECT month FROM budget_months WHERE month < ? ORDER BY month DESC LIMIT 1`)
        .get(target) as { month: string } | undefined) ?? latestRow;
    if (src) {
      fixedItems = d
        .prepare(`SELECT label, amount, sort FROM budget_fixed_items WHERE month = ? ORDER BY sort ASC`)
        .all(src.month) as { label: string; amount: number; sort: number }[];
    }
  }

  const totalFixed = fixedItems.reduce((s, f) => s + f.amount, 0);

  d.prepare(
    `INSERT INTO budget_months (month, income_json, tax_set_aside, variable_json, total_income, total_fixed, total_variable, savings, grade)
     VALUES (?, '[]', 0, '[]', 0, ?, 0, ?, ?)`
  ).run(target, totalFixed, -totalFixed, gradeFor(0, 0, -totalFixed).grade); // income 0 → "—", not "Very Bad"

  const ins = d.prepare(`INSERT INTO budget_fixed_items (month,label,amount,sort) VALUES (?,?,?,?)`);
  fixedItems.forEach((f) => ins.run(target, f.label, f.amount, f.sort));

  return target;
}

/** Back-compat wrapper (cli month-new). */
export function createNewMonth(d: Database.Database = db()): string {
  return createMonth({ mode: "copy" }, d);
}
