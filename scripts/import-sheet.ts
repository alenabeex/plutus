/**
 * scripts/import-sheet.ts
 *
 * Import Alena's Google-Sheet budget export into budget_months / budget_fixed_items.
 *
 * Run:
 *   npx tsx scripts/import-sheet.ts <path-to-xlsx> [--dry-run] [--force]
 *
 * Where to get the .xlsx:
 *   Google Sheets → File → Download → Microsoft Excel (.xlsx)
 *   Save as: ~/Alena OS/01_capture/raw/budget-history.xlsx
 *
 * --dry-run   Print what would be written per tab; commit nothing.
 * --force     Overwrite even months with closed=1.
 *
 * Plan contract: T4.1 — source='sheet', upsert only (never destroy closed app months
 * unless --force).  Reconciliation line per month: income − fixed − variable vs savings.
 * Flag mismatch > $0.01.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as XLSX from "xlsx";

// We need to import from lib/db but the module uses "@/" path aliases and
// also imports next/server stuff transitively.  Use a direct relative path and
// bypass next-only imports by importing db logic directly.
// Better-sqlite3-multiple-ciphers is a native module — it works fine in tsx.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — relative import, tsx resolves it
import { db } from "../lib/db.js";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ParsedMonth {
  month: string;              // '2026-01'
  tabName: string;
  incomeRows: { label: string; value: number }[];
  taxSetAside: number;
  totalIncome: number;
  fixedRows: { label: string; value: number }[];
  totalFixed: number;
  variableRows: { label: string; value: number }[];
  totalVariable: number;
  savings: number;
  cashPct: number | null;
  cashAmt: number | null;
  investedPct: number | null;
  investedAmt: number | null;
  grade: string | null;
  unmatchedLabels: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Normalize a label for fuzzy matching: lowercase, collapse spaces. */
function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function contains(a: string, b: string): boolean {
  return norm(a).includes(norm(b));
}

/** Convert a tab name like 'JAN 2026' → '2026-01'. */
function tabToMonthKey(tab: string): string | null {
  const match = tab.trim().match(/^([A-Za-z]{3,4})\s+(\d{4})$/);
  if (!match) return null;
  const monthNames: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const abbr = match[1].toLowerCase().slice(0, 3);
  const mo = monthNames[abbr];
  if (!mo) return null;
  return `${match[2]}-${mo}`;
}

/** From a worksheet row, get the rightmost non-empty numeric cell value. */
function rightmostNumeric(
  ws: XLSX.WorkSheet,
  rowIdx: number,          // 0-based
  range: XLSX.Range,
): number | null {
  for (let c = range.e.c; c >= range.s.c; c--) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    const cell = ws[addr];
    if (cell && (cell.t === "n" || cell.t === "s")) {
      const v = cell.t === "n" ? cell.v : parseFloat(String(cell.v).replace(/[$,]/g, ""));
      if (!isNaN(v) && isFinite(v)) return v;
    }
  }
  return null;
}

/** Get the string value of cell at (row, col), 0-based. */
function cellStr(ws: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[addr];
  if (!cell) return "";
  return String(cell.v ?? "").trim();
}

const GRADE_VALUES = ["great", "good", "okay", "bad", "very bad"];

// ─── Core parser ───────────────────────────────────────────────────────────

function parseMonthSheet(ws: XLSX.WorkSheet, tabName: string, categories: string[]): ParsedMonth {
  const refStr = ws["!ref"];
  if (!refStr) throw new Error(`Sheet "${tabName}" has no data range`);
  const range = XLSX.utils.decode_range(refStr);

  const month = tabToMonthKey(tabName)!;

  const incomeRows: { label: string; value: number }[] = [];
  const fixedRows: { label: string; value: number }[] = [];
  const variableRows: { label: string; value: number }[] = [];
  const unmatchedLabels: string[] = [];

  let totalIncome = 0;
  let totalFixed = 0;
  let totalVariable = 0;
  let taxSetAside = 0;
  let savings = 0;
  let cashPct: number | null = null;
  let cashAmt: number | null = null;
  let investedPct: number | null = null;
  let investedAmt: number | null = null;
  let grade: string | null = null;

  // State machine: track which section we're in
  type Section = "pre-income" | "income" | "fixed" | "variable" | "post";
  let section: Section = "pre-income";

  const normalizedCats = categories.map(norm);

  for (let r = range.s.r; r <= range.e.r; r++) {
    const label = cellStr(ws, r, range.s.c);
    if (!label) continue;
    const labelN = norm(label);
    const val = rightmostNumeric(ws, r, range);

    // ── Total Income ──
    if (labelN === "total income" || labelN.startsWith("total income")) {
      if (val !== null) totalIncome = val;
      section = "fixed";
      continue;
    }

    // ── Total Fixed ──
    if (labelN === "total fixed" || labelN.startsWith("total fixed")) {
      if (val !== null) totalFixed = val;
      section = "variable";
      continue;
    }

    // ── Total Variable ──
    if (labelN === "total variable" || labelN.startsWith("total variable")) {
      if (val !== null) totalVariable = val;
      section = "post";
      continue;
    }

    // ── Tax (set-aside) ──
    if (contains(labelN, "tax")) {
      if (val !== null) taxSetAside = val;
      // don't change section — tax can appear anywhere
      continue;
    }

    // ── Savings ──
    if (contains(labelN, "saving")) {
      if (val !== null) savings = val;
      // Try to find cash/invested split on nearby columns
      // Look for percentage-like values in the same row
      const pcts: number[] = [];
      const amts: number[] = [];
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        const v = cell.t === "n" ? Number(cell.v) : NaN;
        if (isNaN(v)) continue;
        if (v > 0 && v <= 1) {
          pcts.push(Math.round(v * 100)); // stored as decimal in sheet
        } else if (v > 1 && v <= 100 && Number.isInteger(v)) {
          pcts.push(v);                   // already whole-number percent
        } else if (v > 100) {
          amts.push(v);                   // dollar amount
        }
      }
      if (pcts.length >= 2) {
        cashPct = pcts[0];
        investedPct = pcts[1];
      } else if (pcts.length === 1) {
        cashPct = pcts[0];
        investedPct = 100 - pcts[0];
      }
      if (amts.length >= 2) {
        cashAmt = amts[0];
        investedAmt = amts[1];
      } else if (amts.length === 1 && savings > 0) {
        // derive from the single percent if available
        if (cashPct !== null) {
          cashAmt = Math.round((savings * cashPct) / 100 * 100) / 100;
          investedAmt = Math.round((savings - cashAmt) * 100) / 100;
        }
      }
      continue;
    }

    // ── Grade ──
    {
      const lower = labelN;
      for (const g of GRADE_VALUES) {
        if (lower === g || lower.startsWith(g)) {
          grade = g.charAt(0).toUpperCase() + g.slice(1);
          break;
        }
      }
      // Also check the VALUE cell — sometimes the grade is the value
      if (!grade && val === null) {
        // The label itself might be the grade value cell (e.g. col B has "Great")
        for (let c = range.s.c; c <= range.e.c; c++) {
          const s = norm(cellStr(ws, r, c));
          for (const g of GRADE_VALUES) {
            if (s === g) {
              grade = g.charAt(0).toUpperCase() + g.slice(1);
              break;
            }
          }
          if (grade) break;
        }
      }
      if (grade) continue; // consumed as grade row
    }

    // ── Section-based parsing ──
    if (section === "pre-income") {
      // Could be income item or still heading rows
      if (val !== null) {
        incomeRows.push({ label, value: val });
        section = "income";
      }
      continue;
    }

    if (section === "income") {
      if (val !== null) {
        incomeRows.push({ label, value: val });
      } else {
        unmatchedLabels.push(label);
      }
      continue;
    }

    if (section === "fixed") {
      if (val !== null) {
        fixedRows.push({ label, value: val });
      } else {
        unmatchedLabels.push(label);
      }
      continue;
    }

    if (section === "variable") {
      // Check if this label matches one of the 13 categories
      const catIdx = normalizedCats.findIndex((c) => norm(label) === c || contains(norm(label), c) || contains(c, norm(label)));
      if (val !== null) {
        variableRows.push({ label: catIdx >= 0 ? categories[catIdx] : label, value: val });
      } else {
        unmatchedLabels.push(label);
      }
      continue;
    }

    // section === "post" — ignore unless it's grade/savings (already handled above)
  }

  return {
    month, tabName, incomeRows, taxSetAside, totalIncome,
    fixedRows, totalFixed, variableRows, totalVariable,
    savings, cashPct, cashAmt, investedPct, investedAmt, grade,
    unmatchedLabels,
  };
}

// ─── Grade color (mirrors BudgetView) ──────────────────────────────────────

function gradeColor(g: string | null): string {
  if (!g) return "text-muted-foreground";
  switch (g.toLowerCase()) {
    case "great":    return "#22c55e";
    case "good":     return "#84cc16";
    case "okay":     return "#f59e0b";
    case "bad":      return "#ef4444";
    case "very bad": return "#dc2626";
    default:         return "#6b7280";
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!filePath) {
    console.error("\nUsage: npx tsx scripts/import-sheet.ts <path-to-xlsx> [--dry-run] [--force]");
    console.error("\nHow to get the file:");
    console.error("  Google Sheets → File → Download → Microsoft Excel (.xlsx)");
    console.error("  Save as: ~/Alena OS/01_capture/raw/budget-history.xlsx\n");
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`\nFile not found: ${resolved}`);
    console.error("\nHow to get the file:");
    console.error("  Google Sheets → File → Download → Microsoft Excel (.xlsx)");
    console.error("  Save as: ~/Alena OS/01_capture/raw/budget-history.xlsx\n");
    process.exit(1);
  }

  console.log(`\nReading: ${resolved}`);
  if (dryRun) console.log("Mode: DRY RUN — nothing will be written\n");
  if (force) console.log("Mode: FORCE — will overwrite closed months\n");

  // Load workbook
  const wb = XLSX.readFile(resolved, { cellDates: false });

  // Open DB (not needed in dry-run but we read categories from it)
  const database = db();

  // Read categories
  const categories: string[] = (
    database.prepare("SELECT name FROM categories ORDER BY sort").all() as { name: string }[]
  ).map((r) => r.name);

  if (categories.length === 0) {
    console.warn("Warning: no categories found in DB — variable category matching may be incomplete.");
  }

  // Collect month sheets in chronological order
  const monthSheets: { tab: string; month: string }[] = [];
  for (const sheetName of wb.SheetNames) {
    const monthKey = tabToMonthKey(sheetName);
    if (monthKey) {
      monthSheets.push({ tab: sheetName, month: monthKey });
    }
  }

  // Sort oldest → newest
  monthSheets.sort((a, b) => a.month.localeCompare(b.month));

  if (monthSheets.length === 0) {
    console.error("No month tabs found. Expected names like 'JAN 2026', 'FEB 2026', etc.");
    process.exit(1);
  }

  console.log(`Found ${monthSheets.length} month tab(s): ${monthSheets.map((m) => m.tab).join(", ")}\n`);

  // ── Parse all tabs ──────────────────────────────────────────────────────

  const parsed: ParsedMonth[] = [];
  for (const { tab } of monthSheets) {
    const ws = wb.Sheets[tab];
    try {
      const result = parseMonthSheet(ws, tab, categories);
      parsed.push(result);
    } catch (err) {
      console.error(`Error parsing tab "${tab}": ${err}`);
    }
  }

  // ── Dry-run output ──────────────────────────────────────────────────────

  if (dryRun) {
    for (const p of parsed) {
      console.log(`─── ${p.tabName} (${p.month}) ───────────────────────────────`);
      console.log(`  Income (${p.incomeRows.length} rows):`);
      for (const r of p.incomeRows) {
        console.log(`    ${r.label}: $${r.value.toFixed(2)}`);
      }
      console.log(`  Total Income (parsed): $${p.totalIncome.toFixed(2)}`);
      console.log(`  Tax set-aside: $${p.taxSetAside.toFixed(2)}`);
      console.log(`\n  Fixed (${p.fixedRows.length} items):`);
      for (const r of p.fixedRows) {
        console.log(`    ${r.label}: $${r.value.toFixed(2)}`);
      }
      console.log(`  Total Fixed (parsed): $${p.totalFixed.toFixed(2)}`);
      console.log(`\n  Variable (${p.variableRows.length} rows):`);
      for (const r of p.variableRows) {
        console.log(`    ${r.label}: $${r.value.toFixed(2)}`);
      }
      console.log(`  Total Variable (parsed): $${p.totalVariable.toFixed(2)}`);
      console.log(`\n  Savings: $${p.savings.toFixed(2)}`);
      if (p.cashPct !== null) console.log(`  Cash: ${p.cashPct}% ($${(p.cashAmt ?? 0).toFixed(2)})`);
      if (p.investedPct !== null) console.log(`  Invested: ${p.investedPct}% ($${(p.investedAmt ?? 0).toFixed(2)})`);
      console.log(`  Grade: ${p.grade ?? "(not found)"}`);

      // Reconciliation
      const computed = p.totalIncome - p.totalFixed - p.totalVariable;
      const diff = Math.abs(computed - p.savings);
      const flag = diff > 0.01 ? "  *** MISMATCH ***" : "  OK";
      console.log(`\n  Reconciliation: income(${p.totalIncome.toFixed(2)}) − fixed(${p.totalFixed.toFixed(2)}) − variable(${p.totalVariable.toFixed(2)}) = ${computed.toFixed(2)} | savings=${p.savings.toFixed(2)} | diff=${diff.toFixed(2)}${flag}`);

      if (p.unmatchedLabels.length > 0) {
        console.log(`\n  Unmatched labels (${p.unmatchedLabels.length}):`);
        for (const u of p.unmatchedLabels) {
          console.log(`    - "${u}"`);
        }
      }
      console.log();
    }
    console.log("Dry run complete — nothing written.");
    return;
  }

  // ── Commit to DB ────────────────────────────────────────────────────────

  const insBudgetMonth = database.prepare(`
    INSERT INTO budget_months
      (month, income_json, tax_set_aside, variable_json,
       total_income, total_fixed, total_variable,
       savings, cash_pct, cash_amt, invested_pct, invested_amt,
       grade, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'sheet')
    ON CONFLICT(month) DO UPDATE SET
      income_json   = excluded.income_json,
      tax_set_aside = excluded.tax_set_aside,
      variable_json = excluded.variable_json,
      total_income  = excluded.total_income,
      total_fixed   = excluded.total_fixed,
      total_variable = excluded.total_variable,
      savings       = excluded.savings,
      cash_pct      = excluded.cash_pct,
      cash_amt      = excluded.cash_amt,
      invested_pct  = excluded.invested_pct,
      invested_amt  = excluded.invested_amt,
      grade         = excluded.grade,
      source        = 'sheet'
    WHERE (SELECT closed FROM budget_months WHERE month = excluded.month) != 1
       OR ${force ? "1=1" : "0=1"}
  `);

  const delFixed = database.prepare(`DELETE FROM budget_fixed_items WHERE month = ?`);
  const insFixed = database.prepare(
    `INSERT INTO budget_fixed_items (month, label, amount, sort) VALUES (?, ?, ?, ?)`
  );

  const importMonth = database.transaction((p: ParsedMonth) => {
    // Check closed status
    const existing = database.prepare(`SELECT closed FROM budget_months WHERE month = ?`).get(p.month) as
      | { closed: number }
      | undefined;

    if (existing?.closed === 1 && !force) {
      console.log(`  SKIPPED (month is closed=1; use --force to overwrite)`);
      return false;
    }

    insBudgetMonth.run(
      p.month,
      JSON.stringify(p.incomeRows),
      p.taxSetAside,
      JSON.stringify(p.variableRows),
      p.totalIncome,
      p.totalFixed,
      p.totalVariable,
      p.savings,
      p.cashPct,
      p.cashAmt,
      p.investedPct,
      p.investedAmt,
      p.grade,
    );

    // Replace fixed items entirely
    delFixed.run(p.month);
    p.fixedRows.forEach(({ label, value }, i) => {
      insFixed.run(p.month, label, value, i);
    });

    return true;
  });

  let imported = 0;
  let skipped = 0;

  for (const p of parsed) {
    console.log(`Processing ${p.tabName} (${p.month})…`);

    // Reconciliation always printed
    const computed = p.totalIncome - p.totalFixed - p.totalVariable;
    const diff = Math.abs(computed - p.savings);
    const flag = diff > 0.01 ? "  *** MISMATCH ***" : "  OK";
    console.log(`  Reconciliation: ${p.totalIncome.toFixed(2)} − ${p.totalFixed.toFixed(2)} − ${p.totalVariable.toFixed(2)} = ${computed.toFixed(2)} | savings=${p.savings.toFixed(2)} | diff=${diff.toFixed(2)}${flag}`);

    if (p.unmatchedLabels.length > 0) {
      console.log(`  Unmatched labels: ${p.unmatchedLabels.join(", ")}`);
    }

    const ok = importMonth(p);
    if (ok) {
      console.log(`  Imported: ${p.incomeRows.length} income rows, ${p.fixedRows.length} fixed items, ${p.variableRows.length} variable rows`);
      imported++;
    } else {
      skipped++;
    }
  }

  // Final summary
  console.log(`\nDone. Imported: ${imported} | Skipped (closed): ${skipped}`);

  // Print months now in DB
  const months = database.prepare(
    `SELECT month, source, closed, grade, total_income, savings FROM budget_months ORDER BY month`
  ).all() as { month: string; source: string; closed: number; grade: string | null; total_income: number; savings: number }[];

  console.log(`\nMonths in DB (${months.length}):`);
  for (const m of months) {
    const closedFlag = m.closed ? " [closed]" : "";
    console.log(`  ${m.month}  source=${m.source}  income=$${m.total_income.toFixed(2)}  savings=$${m.savings.toFixed(2)}  grade=${m.grade ?? "-"}${closedFlag}`);
  }
}

main();
