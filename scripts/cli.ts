/**
 * scripts/cli.ts
 *
 * Ops CLI for the runbook/launchd phase — the day-to-day operator (a
 * cheaper model, per runbook.md) drives the app through these commands
 * instead of touching schema or code.
 *
 * Run:
 *   npx tsx scripts/cli.ts <command> [args]
 *
 * Commands:
 *   snapshot                 Run a net-worth snapshot, print totals + per-account balances.
 *   sync                     Run Plaid balance/transaction sync (no-op, exit 0, if not configured).
 *   month-close [YYYY-MM]    Close a budget month (default: latest open month). Requires --confirm.
 *   month-new                Roll over to the next month (copy fixed items, zero income/variable).
 *   help                     Print this usage text.
 *
 * Exit codes: 0 success, 1 refusal/error.
 */

// We need to import from lib/* but those modules use "@/" path aliases and
// also import next/server stuff transitively. Use a direct relative path and
// bypass next-only imports by importing the lib logic directly.
// Better-sqlite3-multiple-ciphers is a native module — it works fine in tsx.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — relative import, tsx resolves it
import { db, snapshotNetworth, latestBalances } from "../lib/db.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — relative import, tsx resolves it
import { runPlaidSync } from "../lib/sync.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — relative import, tsx resolves it
import { createNewMonth, BudgetOpsError } from "../lib/budget-ops.js";

// ─── Types ─────────────────────────────────────────────────────────────────

interface BudgetMonthRow {
  month: string;
  total_income: number;
  total_fixed: number;
  total_variable: number;
  savings: number;
  grade: string | null;
  closed: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// AGENTS.md rule 5: ops sessions consume aggregates, not raw dumps. Raw
// per-account balances / month dollar totals only print in demo mode or
// with an explicit --real flag from Alena.
const ALLOW_RAW = process.env.FT_DEMO === "1" || process.argv.includes("--real");
const RAW_NOTICE = "  (raw amounts hidden — run with --real or FT_DEMO=1)";

function usage(): void {
  console.log(`
Usage: npx tsx scripts/cli.ts <command> [args]

Commands:
  snapshot                 Run a net-worth snapshot, print totals + per-account balances.
  sync                     Run Plaid balance/transaction sync (prints "plaid not configured" and
                            exits 0 if no Plaid credentials are in Keychain — manual-only is valid).
  month-close [YYYY-MM]    Close a budget month (default: latest open month).
                            Refuses if the month doesn't exist or is already closed.
                            Destructive — requires --confirm, else prints what it would do and exits 1.
  month-new                Roll over to the next month: copies fixed items from the latest month,
                            zeroes income/variable.
  help                     Print this usage text.

Exit codes: 0 success, 1 refusal/error.
`);
}

function printMonthTotals(row: BudgetMonthRow): void {
  console.log(`  Grade:     ${row.grade ?? "-"}`);
  if (!ALLOW_RAW) { console.log(RAW_NOTICE); return; }
  console.log(`  Income:    $${row.total_income.toFixed(2)}`);
  console.log(`  Fixed:     $${row.total_fixed.toFixed(2)}`);
  console.log(`  Variable:  $${row.total_variable.toFixed(2)}`);
  console.log(`  Savings:   $${row.savings.toFixed(2)}`);
}

// ─── Commands ──────────────────────────────────────────────────────────────

function cmdSnapshot(): void {
  const result = snapshotNetworth();
  console.log(`Snapshot ${result.date}`);

  const balances = latestBalances() as {
    id: number; code: string; name: string; institution: string; sub: string;
    kind: string; is_liability: number; value: number;
  }[];

  if (!ALLOW_RAW) {
    console.log(`  recorded. ${balances.length} account(s) updated.`);
    console.log(RAW_NOTICE);
    process.exit(0);
  }
  console.log(`  Assets:      $${result.assets.toFixed(2)}`);
  console.log(`  Liabilities: $${result.liabilities.toFixed(2)}`);
  console.log(`  Total:       $${result.total.toFixed(2)}`);
  console.log(`\nPer-account latest balances:`);
  const nameW = Math.max(4, ...balances.map((b: { name: string }) => b.name.length));
  const kindW = Math.max(4, ...balances.map((b: { kind: string }) => b.kind.length));
  console.log(`  ${"NAME".padEnd(nameW)}  ${"KIND".padEnd(kindW)}  ${"LIAB".padEnd(4)}  VALUE`);
  for (const b of balances) {
    const value = b.value ?? 0;
    console.log(
      `  ${b.name.padEnd(nameW)}  ${b.kind.padEnd(kindW)}  ${(b.is_liability ? "yes" : "no").padEnd(4)}  $${value.toFixed(2)}`,
    );
  }
  process.exit(0);
}

async function cmdSync(): Promise<void> {
  const result = await runPlaidSync();

  if (!result.configured) {
    console.log("plaid not configured");
    process.exit(0);
  }

  console.log(`Synced ${result.synced} item(s).`);
  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`);
    for (const e of result.errors) console.log(`  - ${e}`);
  } else {
    console.log("No errors.");
  }
  process.exit(0);
}

function cmdMonthClose(args: string[]): void {
  const confirm = args.includes("--confirm");
  const monthArg = args.find((a) => !a.startsWith("--"));

  const d = db();
  let month: string;

  if (monthArg) {
    if (!/^\d{4}-\d{2}$/.test(monthArg)) {
      console.error(`Refused: invalid month "${monthArg}" — expected format YYYY-MM.`);
      process.exit(1);
    }
    month = monthArg;
  } else {
    const row = d
      .prepare(`SELECT month FROM budget_months WHERE closed = 0 ORDER BY month DESC LIMIT 1`)
      .get() as { month: string } | undefined;
    if (!row) {
      console.error(`Refused: no open months found.`);
      process.exit(1);
    }
    month = row.month;
  }

  const row = d.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as
    | BudgetMonthRow
    | undefined;

  if (!row) {
    console.error(`Refused: month ${month} not found.`);
    process.exit(1);
  }
  if (row.closed) {
    console.error(`Refused: month ${month} is already closed.`);
    process.exit(1);
  }

  if (!confirm) {
    console.log(`Would close month ${month}:`);
    printMonthTotals(row);
    console.log(`\nRe-run with --confirm to close this month.`);
    process.exit(1);
  }

  d.prepare(`UPDATE budget_months SET closed = 1 WHERE month = ?`).run(month);
  console.log(`Closed month ${month}.`);
  printMonthTotals(row);
  process.exit(0);
}

function cmdMonthNew(): void {
  try {
    const nextMonth = createNewMonth();
    const row = db().prepare(`SELECT * FROM budget_months WHERE month = ?`).get(nextMonth) as BudgetMonthRow;
    console.log(`Created month ${nextMonth}.`);
    printMonthTotals(row);
    process.exit(0);
  } catch (e) {
    if (e instanceof BudgetOpsError) {
      console.error(`Refused: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "snapshot":
      cmdSnapshot();
      break;
    case "sync":
      await cmdSync();
      break;
    case "month-close":
      cmdMonthClose(rest);
      break;
    case "month-new":
      cmdMonthNew();
      break;
    case "help":
    case undefined:
      usage();
      process.exit(0);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
