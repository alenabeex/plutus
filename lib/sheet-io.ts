import * as XLSX from "xlsx";
import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import { gradeFor } from "./format";

// Excel round-trip for month sheets. Format matches the Google-Sheet importer
// rules (scripts/import-sheet.ts): tab per month named 'JAN 2026', labels in
// column A, values in column B. Income rows sit above 'Total Income'; fixed
// items between 'Total Income' and 'Total Fixed'; the 13 category rows follow;
// then 'Total Variable', 'Savings', 'Result', 'Tax set-aside'.

const MONTH_TAB = /^([A-Z]{3,4}) (\d{4})$/i;
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

export function monthKeyFromTab(tab: string): string | null {
  const m = MONTH_TAB.exec(tab.trim());
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1].toUpperCase().slice(0, 3));
  if (idx < 0) return null;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}

function tabFromMonthKey(month: string): string {
  const [y, mo] = month.split("-");
  return `${MONTHS[parseInt(mo, 10) - 1]} ${y}`;
}

/* ── export ─────────────────────────────────────────────────────────────── */

export function exportMonthXlsx(month: string, d: Database.Database = db()): Buffer {
  const row = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as {
    income_json: string; variable_json: string; tax_set_aside: number;
    total_income: number; total_fixed: number; total_variable: number;
    savings: number; grade: string | null;
  } | undefined;
  if (!row) throw new Error(`Month ${month} not found`);

  const income = JSON.parse(row.income_json) as { label: string; value: number }[];
  const variable = JSON.parse(row.variable_json) as { label: string; value: number }[];
  const fixed = d
    .prepare(`SELECT label, amount FROM budget_fixed_items WHERE month = ? ORDER BY sort ASC`)
    .all(month) as { label: string; amount: number }[];

  const aoa: (string | number)[][] = [
    ...income.map((i) => [i.label, i.value]),
    ["Total Income", row.total_income],
    ...fixed.map((f) => [f.label, f.amount]),
    ["Total Fixed", row.total_fixed],
    ...variable.map((v) => [v.label, v.value]),
    ["Total Variable", row.total_variable],
    ["Savings", row.savings],
    ["Result", row.grade ?? ""],
    ["Tax set-aside", row.tax_set_aside ?? 0],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), tabFromMonthKey(month));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/* ── import ─────────────────────────────────────────────────────────────── */

export interface ImportResult {
  imported: string[];
  skipped: { tab: string; reason: string }[];
  warnings: string[];
}

/** Label-driven tolerant parse of one month tab. */
function parseTab(
  sheet: XLSX.WorkSheet,
  categories: string[],
): {
  income: { label: string; value: number }[];
  fixed: { label: string; value: number }[];
  variable: { label: string; value: number }[];
  taxSetAside: number;
} | null {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1, blankrows: false,
  });

  // label = first string cell; value = rightmost numeric cell in the row
  const lines: { label: string; value: number | null; raw: string }[] = rows
    .map((r) => {
      const label = String(r.find((c) => typeof c === "string" && String(c).trim()) ?? "").trim();
      const nums = r.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
      return { label, value: nums.length ? nums[nums.length - 1] : null, raw: label.toLowerCase() };
    })
    .filter((l) => l.label);

  const idxIncome = lines.findIndex((l) => l.raw.startsWith("total income"));
  const idxFixed = lines.findIndex((l) => l.raw.startsWith("total fixed"));
  if (idxIncome < 0 || idxFixed < 0) return null;

  const catSet = new Set(categories.map((c) => c.toLowerCase()));
  const isTotalish = (raw: string) =>
    raw.startsWith("total ") || raw.startsWith("savings") || raw.startsWith("result");

  const income = lines
    .slice(0, idxIncome)
    .filter((l) => l.value !== null && !l.raw.includes("tax"))
    .map((l) => ({ label: l.label, value: l.value as number }));

  const fixed = lines
    .slice(idxIncome + 1, idxFixed)
    .filter((l) => l.value !== null && !isTotalish(l.raw))
    .map((l) => ({ label: l.label, value: l.value as number }));

  // categories anywhere after Total Fixed, matched by name (order preserved
  // from the canonical list; missing ones default 0)
  const after = lines.slice(idxFixed + 1);
  const variable = categories.map((cat) => {
    const hit = after.find((l) => l.raw === cat.toLowerCase() && l.value !== null);
    return { label: cat, value: hit ? (hit.value as number) : 0 };
  });
  // guard: unknown non-total labels with values that aren't categories → count
  void catSet;

  const taxLine = lines.find((l) => l.raw.includes("tax") && l.value !== null);

  return { income, fixed, variable, taxSetAside: taxLine ? (taxLine.value as number) : 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function importWorkbook(buf: Buffer, d: Database.Database = db()): ImportResult {
  // hardened parse of an untrusted workbook: no formulas/HTML, bounded rows
  const wb = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false, sheetRows: 5000 });
  const categories = (
    d.prepare(`SELECT name FROM categories ORDER BY sort ASC`).all() as { name: string }[]
  ).map((r) => r.name);

  const result: ImportResult = { imported: [], skipped: [], warnings: [] };

  const tabs = wb.SheetNames
    .map((tab) => ({ tab, month: monthKeyFromTab(tab) }))
    .filter((t): t is { tab: string; month: string } => !!t.month)
    .sort((a, b) => a.month.localeCompare(b.month));

  if (!tabs.length) {
    result.warnings.push("No tabs named like 'JAN 2026' found in the workbook.");
    return result;
  }

  const insMonth = d.prepare(
    `INSERT INTO budget_months (month,income_json,tax_set_aside,variable_json,total_income,total_fixed,total_variable,savings,grade,source)
     VALUES (?,?,?,?,?,?,?,?,?,'sheet')
     ON CONFLICT(month) DO UPDATE SET
       income_json=excluded.income_json, tax_set_aside=excluded.tax_set_aside,
       variable_json=excluded.variable_json, total_income=excluded.total_income,
       total_fixed=excluded.total_fixed, total_variable=excluded.total_variable,
       savings=excluded.savings, grade=excluded.grade, source='sheet'
     WHERE budget_months.closed = 0`,
  );
  const delFixed = d.prepare(`DELETE FROM budget_fixed_items WHERE month = ?`);
  const insFixed = d.prepare(`INSERT INTO budget_fixed_items (month,label,amount,sort) VALUES (?,?,?,?)`);

  for (const { tab, month } of tabs) {
    const closed = d.prepare(`SELECT closed FROM budget_months WHERE month = ?`).get(month) as
      | { closed: number } | undefined;
    if (closed?.closed) {
      result.skipped.push({ tab, reason: "month is closed" });
      continue;
    }

    const parsed = parseTab(wb.Sheets[tab], categories);
    if (!parsed) {
      result.skipped.push({ tab, reason: "missing 'Total Income' / 'Total Fixed' rows" });
      continue;
    }

    const totalIncome = round2(parsed.income.reduce((s, i) => s + i.value, 0));
    const totalFixed = round2(parsed.fixed.reduce((s, f) => s + f.value, 0));
    const totalVariable = round2(parsed.variable.reduce((s, v) => s + v.value, 0));
    const savings = round2(totalIncome - totalFixed - totalVariable);

    const { grade } = gradeFor(totalIncome, totalVariable, savings);

    insMonth.run(
      month, JSON.stringify(parsed.income), parsed.taxSetAside, JSON.stringify(parsed.variable),
      totalIncome, totalFixed, totalVariable, savings, grade,
    );
    delFixed.run(month);
    parsed.fixed.forEach((f, i) => insFixed.run(month, f.label, f.value, i));
    result.imported.push(month);
  }

  return result;
}
