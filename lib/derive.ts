import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import type { CashflowRow } from "./types";

// Derivation layer: linked-connection data → the three views.
// - Net worth: already derived (accounts+balances → latestBalances).
// - Cash Flow (plan §Phase 4, derivation contract 2026-07-25):
//     classify every transaction income/expense/transfer by account role,
//     then Income = income txns, Needs = need-category expenses itemized by
//     merchant, Wants = want-category sums (+ Uncategorized so Savings math
//     never overstates), Savings = Income − Needs − Wants.
// - Subscriptions: recurring-charge detection over transactions (this file).
// Runs at the end of every Plaid sync AND lazily from the budget route
// (demo/no-sync installs); everything is idempotent.

/* ── transaction classification (income / expense / transfer) ───────────── */

// Transfer fingerprints: credit-card payments and own-account moves. These
// must vanish from BOTH sides of Cash Flow or income and expenses double.
const TRANSFER_PATTERNS = [
  "payment thank you", "autopay", "auto pay", "automatic payment",
  "credit crd", "crd epay", "card payment", "e-payment", "epay",
  "online transfer", "transfer to", "transfer from", "internal transfer",
  "ach transfer", "cashout", "cash out",
];

const isTransferText = (hay: string) => TRANSFER_PATTERNS.some((p) => hay.includes(p));
const isTransferPfc = (pfc: string | null) =>
  !!pfc && (pfc.startsWith("TRANSFER_") || pfc.includes("CREDIT_CARD_PAYMENT"));

/** Account's role in cash flow. Explicit accounts.cashflow_role wins; else:
 *  P2P wallets (Venmo/Cash App/PayPal) spend but never earn — their inflows
 *  are reimbursements; cash accounts do both (income in, spending out);
 *  credit cards spend; investment/manual sit outside cash flow. */
function roleFor(a: { kind: string; institution: string | null; name: string; cashflow_role: string | null }): string {
  if (a.cashflow_role) return a.cashflow_role;
  const label = `${a.institution ?? ""} ${a.name}`.toLowerCase();
  if (/venmo|cash app|paypal/.test(label)) return "spending";
  if (a.kind === "cash") return "both";
  if (a.kind === "credit") return "spending";
  return "exclude";
}

/** Fill txn_class for every unclassified, settled transaction. Idempotent —
 *  only NULL rows are touched, so a manual correction is never clobbered. */
export function classifyTransactions(d: Database.Database = db()): number {
  const rows = d.prepare(
    `SELECT t.id, t.name, t.merchant, t.amount, t.pfc,
            a.kind, a.institution, a.name AS acct_name, a.cashflow_role
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.txn_class IS NULL AND t.pending = 0`,
  ).all() as {
    id: number; name: string | null; merchant: string | null; amount: number;
    pfc: string | null; kind: string; institution: string | null;
    acct_name: string; cashflow_role: string | null;
  }[];

  const upd = d.prepare(`UPDATE transactions SET txn_class = ? WHERE id = ?`);
  let n = 0;
  for (const t of rows) {
    const role = roleFor({ kind: t.kind, institution: t.institution, name: t.acct_name, cashflow_role: t.cashflow_role });
    const hay = `${t.merchant ?? ""} ${t.name ?? ""}`.toLowerCase();
    const transferish = isTransferPfc(t.pfc) || isTransferText(hay);

    let klass: string;
    if (role === "exclude") klass = "transfer";
    else if (transferish) klass = "transfer";
    else if (t.amount > 0) klass = "expense"; // money out
    else if (role === "both" || role === "income") klass = "income"; // money into a cash account
    else klass = "transfer"; // inflow to a card/P2P wallet: refund-adjacent, not income
    // refund exception: money back onto a credit card offsets spending
    if (klass === "transfer" && role === "spending" && t.kind === "credit" && t.amount < 0 && !transferish) {
      klass = "expense";
    }
    upd.run(klass, t.id);
    n++;
  }
  return n;
}

/* ── categorization (plan T4.2) ─────────────────────────────────────────── */

// Starter rules: substring (LIKE) patterns → her 13 categories. Corrections
// made in the app become new rows in category_rules and win over these.
const DEFAULT_RULES: [pattern: string, category: string][] = [
  ["grocery", "Groceries"], ["market", "Groceries"], ["trader joe", "Groceries"],
  ["whole foods", "Groceries"], ["safeway", "Groceries"], ["costco", "Groceries"],
  ["restaurant", "Eat Out"], ["cafe", "Eat Out"], ["coffee", "Eat Out"],
  ["doordash", "Eat Out"], ["ubereats", "Eat Out"], ["grubhub", "Eat Out"],
  ["pizza", "Eat Out"], ["sushi", "Eat Out"], ["taco", "Eat Out"],
  ["cinema", "Events / Ent."], ["theatre", "Events / Ent."], ["ticketmaster", "Events / Ent."],
  ["autozone", "Car Mainten."], ["jiffy lube", "Car Mainten."], ["mechanic", "Car Mainten."],
  ["home depot", "Misc. / Maint / Home"], ["lowes", "Misc. / Maint / Home"], ["ikea", "Misc. / Maint / Home"],
  ["petco", "Pets"], ["petsmart", "Pets"], ["chewy", "Pets"],
  ["shell", "Car Gas"], ["chevron", "Car Gas"], ["exxon", "Car Gas"], ["76 ", "Car Gas"], ["arco", "Car Gas"],
  ["parking", "Travel / Parking"], ["airline", "Travel / Parking"], ["airbnb", "Travel / Parking"],
  ["hotel", "Travel / Parking"], ["lyft", "Travel / Parking"], ["uber", "Travel / Parking"],
  ["amazon", "Shopping / Personal"], ["target", "Shopping / Personal"], ["sephora", "Shopping / Personal"],
  ["udemy", "Education / Training"], ["coursera", "Education / Training"],
  ["spotify", "Apps / Subs"], ["netflix", "Apps / Subs"], ["hulu", "Apps / Subs"],
  ["apple.com", "Apps / Subs"], ["google", "Apps / Subs"], ["openai", "Apps / Subs"],
  ["interest", "Interest Fees / Violations"], ["late fee", "Interest Fees / Violations"],
  ["overdraft", "Interest Fees / Violations"], ["citation", "Interest Fees / Violations"],
  // needs (grp='need' categories — bills and subscriptions)
  // bare "rent" would hit "car rental"; anchor to the payment forms instead
  ["rent ach", "Rent / Housing"], ["rent payment", "Rent / Housing"],
  ["propert", "Rent / Housing"], ["apartment", "Rent / Housing"], ["mortgage", "Rent / Housing"],
  ["pg&e", "Utilities"], ["pgande", "Utilities"], ["edison", "Utilities"],
  ["utility", "Utilities"], ["utilities", "Utilities"], ["electric co", "Utilities"],
  ["water dept", "Utilities"], ["waste management", "Utilities"],
  ["comcast", "Phone / Internet"], ["xfinity", "Phone / Internet"], ["verizon", "Phone / Internet"],
  ["t-mobile", "Phone / Internet"], ["tmobile", "Phone / Internet"], ["at&t", "Phone / Internet"],
  ["spectrum", "Phone / Internet"], ["internet", "Phone / Internet"], ["wireless", "Phone / Internet"],
  ["insurance", "Insurance"], ["geico", "Insurance"], ["state farm", "Insurance"],
  ["progressive", "Insurance"], ["allstate", "Insurance"],
  ["pharmacy", "Medical / Health"], ["cvs", "Medical / Health"], ["walgreens", "Medical / Health"],
  ["clinic", "Medical / Health"], ["dental", "Medical / Health"], ["kaiser", "Medical / Health"],
  ["streamflix", "Apps / Subs"], ["gym", "Apps / Subs"],
];

/** Ensure starter rules exist. Pattern-level idempotent: each missing
 *  pattern is added, so new defaults reach databases that seeded earlier
 *  rule sets. User corrections (their own rows) are never touched. */
function seedDefaultRules(d: Database.Database = db()): void {
  const have = new Set(
    (d.prepare(`SELECT pattern FROM category_rules`).all() as { pattern: string }[])
      .map((r) => r.pattern.toLowerCase()),
  );
  const cat = d.prepare(`SELECT id FROM categories WHERE name = ?`);
  const ins = d.prepare(`INSERT INTO category_rules (pattern, field, category_id) VALUES (?, 'merchant', ?)`);
  for (const [pattern, name] of DEFAULT_RULES) {
    if (have.has(pattern)) continue;
    const row = cat.get(name) as { id: number } | undefined;
    if (row) ins.run(pattern, row.id);
  }
}

/** Apply rules to every uncategorized transaction. Longest pattern wins
 *  (most specific). Returns how many got a category. */
export function categorizeTransactions(d: Database.Database = db()): number {
  seedDefaultRules(d);
  const rules = (d.prepare(
    `SELECT pattern, category_id FROM category_rules ORDER BY LENGTH(pattern) DESC`,
  ).all() as { pattern: string; category_id: number }[]);

  const uncat = d.prepare(
    `SELECT id, name, merchant FROM transactions WHERE category_id IS NULL AND pending = 0`,
  ).all() as { id: number; name: string | null; merchant: string | null }[];

  const upd = d.prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`);
  let hits = 0;
  for (const t of uncat) {
    const hay = `${t.merchant ?? ""} ${t.name ?? ""}`.toLowerCase();
    const rule = rules.find((r) => hay.includes(r.pattern.toLowerCase()));
    if (rule) { upd.run(rule.category_id, t.id); hits++; }
  }
  return hits;
}

/* ── cash-flow derivation (plan T4.2/T4.3) ──────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Months materialize from transaction dates (plan T4.4), but ONLY the
 *  current month auto-materializes (spec 2026-07-28). Deep backfill (730-day
 *  history at link time) would otherwise dump ~24 months of never-reviewed
 *  data into Cash Flow as if it were settled — past months from backfill sit
 *  gated behind the explicit "Sync Month" action instead, so history never
 *  appears pre-reviewed. Existing budget_months rows (grandfathered) and the
 *  live month are untouched/always materialized respectively. */
export function ensureMonthsFromTransactions(
  d: Database.Database = db(),
  nowMonth: string = new Date().toISOString().slice(0, 7),
): void {
  const months = d.prepare(
    `SELECT DISTINCT substr(date, 1, 7) m FROM transactions WHERE pending = 0 AND date IS NOT NULL`,
  ).all() as { m: string }[];
  const ins = d.prepare(`INSERT OR IGNORE INTO budget_months (month) VALUES (?)`);
  for (const { m } of months) if (/^\d{4}-\d{2}$/.test(m) && m >= nowMonth) ins.run(m);
}

/* ── recurring detection (plan T5.1) ────────────────────────────────────── */

/** Group by merchant, look for ≥3 charges with ~monthly (25–35d) or ~annual
 *  (330–400d) spacing and amounts within ±15% of their median. New finds are
 *  inserted with status='detected' → they surface in the Subscriptions view's
 *  "Newly Detected" card for confirm/dismiss. Idempotent: names already in
 *  the subscriptions table (any status) are never re-inserted. */
export function detectRecurring(d: Database.Database = db()): number {
  const rows = d.prepare(
    `SELECT COALESCE(NULLIF(TRIM(merchant), ''), name) who, date, amount
     FROM transactions WHERE pending = 0 AND amount > 0 ORDER BY who, date`,
  ).all() as { who: string | null; date: string; amount: number }[];

  const known = new Set(
    (d.prepare(`SELECT name FROM subscriptions`).all() as { name: string }[])
      .map((r) => r.name.toLowerCase()),
  );

  const groups = new Map<string, { date: string; amount: number }[]>();
  for (const r of rows) {
    if (!r.who) continue;
    const k = r.who.trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ date: r.date, amount: r.amount });
  }

  const ins = d.prepare(
    `INSERT INTO subscriptions (name, amount, day, cadence, kind, renewal, approx, status)
     VALUES (?, ?, ?, ?, 'subscription', ?, ?, 'detected')`,
  );

  let found = 0;
  for (const [who, txns] of groups) {
    if (txns.length < 3 || known.has(who.toLowerCase())) continue;

    const amounts = [...txns.map((t) => t.amount)].sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (!txns.every((t) => Math.abs(t.amount - median) <= median * 0.15)) continue;

    const days = txns.map((t) => new Date(t.date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / 86400000);
    const monthly = gaps.every((g) => g >= 25 && g <= 35);
    const annual = gaps.every((g) => g >= 330 && g <= 400);
    if (!monthly && !annual) continue;

    const lastDate = txns[txns.length - 1].date;
    const dayOfMonth = parseInt(lastDate.slice(8, 10), 10);
    const renewal = annual
      ? ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][parseInt(lastDate.slice(5, 7), 10) - 1]
      : null;
    const approx = txns.every((t) => t.amount === txns[0].amount) ? 0 : 1;

    ins.run(who, median, dayOfMonth, monthly ? "monthly" : "annual", renewal, approx);
    found++;
  }
  return found;
}

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
      const row = expenseBy.get(key) ?? { label: key, value: 0, txns: [], grp: r.grp === "need" ? "need" : "want" };
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

/** Full post-sync derivation pass. */
export function deriveAll(d: Database.Database = db()): { classified: number; categorized: number; detected: number } {
  const classified = classifyTransactions(d);
  const categorized = categorizeTransactions(d);
  ensureMonthsFromTransactions(d);
  const detected = detectRecurring(d);
  return { classified, categorized, detected };
}
